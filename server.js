import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const FEE = 0.10;
const ROOT = path.join(__dirname, "public");
const DB_PATH = path.join(__dirname, "data", "db.json");
const SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

function loadEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const cut = line.indexOf("=");
    if (cut < 1 || line.startsWith("#")) continue;
    const key = line.slice(0, cut).trim();
    if (!process.env[key]) process.env[key] = line.slice(cut + 1).trim();
  }
}
loadEnv();

const banks = [
  ["044", "Access Bank"], ["063", "Access Bank (Diamond)"], ["050", "Ecobank"],
  ["070", "Fidelity Bank"], ["011", "First Bank"], ["214", "FCMB"],
  ["058", "GTBank"], ["030", "Heritage Bank"], ["082", "Keystone Bank"],
  ["076", "Polaris Bank"], ["101", "Providus Bank"], ["221", "Stanbic IBTC"],
  ["068", "Standard Chartered"], ["232", "Sterling Bank"], ["032", "Union Bank"],
  ["033", "UBA"], ["215", "Unity Bank"], ["035", "Wema Bank"], ["057", "Zenith Bank"],
  ["50211", "Kuda"], ["999992", "Opay"], ["090405", "Moniepoint"]
];

function empty() {
  return { users: [], items: [], orders: [], sessions: [] };
}
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); } catch { return empty(); }
}
function writeDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function id(prefix) { return prefix + crypto.randomBytes(6).toString("hex"); }
function hash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const digest = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, digest };
}
function feeOf(n) { return Math.round(n * FEE); }
function publicItem(item) {
  return { id: item.id, title: item.title, price: item.price, city: item.city, state: item.state, condition: item.condition, note: item.note, image: item.image, sellerName: item.sellerName, hold: item.hold };
}
function userView(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, bankCode: user.bankCode || "", accountNumber: user.accountNumber || "", accountName: user.accountName || "" };
}

async function paystack(pathname, body) {
  const key = process.env.PAYSTACK_SECRET_KEY || SECRET;
  const response = await fetch("https://api.paystack.co" + pathname, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || data.status === false) throw new Error(data.message || "Paystack refused the request");
  return data;
}

function release(db, order) {
  const key = process.env.PAYSTACK_SECRET_KEY || SECRET;
  if (!key) {
    order.status = "released";
    order.releasedAt = new Date().toISOString();
    order.transfer = "demo";
    return;
  }
  const seller = db.users.find((user) => user.id === order.sellerId);
  if (!seller || !seller.accountNumber || !seller.bankCode) throw new Error("Seller has no bank account on file");
  return paystack("/transferrecipient", {
    type: "nuban",
    name: seller.accountName || seller.name,
    account_number: seller.accountNumber,
    bank_code: seller.bankCode,
    currency: "NGN"
  }).then((recipient) => paystack("/transfer", {
    source: "balance",
    amount: order.net * 100,
    recipient: recipient.data.recipient_code,
    reason: "Ocune Declutter " + order.id,
    reference: "ocune_" + order.id
  })).then((transfer) => {
    order.status = "released";
    order.releasedAt = new Date().toISOString();
    order.transfer = transfer.data.transfer_code || transfer.data.reference;
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const cut = part.indexOf("=");
    if (cut > 0) out[part.slice(0, cut).trim()] = decodeURIComponent(part.slice(cut + 1).trim());
  }
  return out;
}
function send(res, code, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...extra });
  res.end(payload);
}
function auth(db, req) {
  const token = cookies(req).ocune;
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_URL);
  if (url.pathname.startsWith("/api/")) {
    try { await route(req, res, url); }
    catch (err) { send(res, 400, { error: err.message || "Request failed" }); }
    return;
  }
  const file = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg" };
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

async function route(req, res, url) {
  const db = readDb();
  const me = auth(db, req);
  if (req.method === "GET" && url.pathname === "/api/me") return send(res, 200, { user: userView(me), live: Boolean(process.env.PAYSTACK_SECRET_KEY || SECRET), banks });
  if (req.method === "POST" && url.pathname === "/api/signup") {
    const body = JSON.parse(await readBody(req));
    if (!body.name || !body.email || !body.password || !body.phone) throw new Error("Name, email, phone, and password are required");
    if (db.users.some((user) => user.email === body.email.toLowerCase())) throw new Error("That email is already registered");
    const user = { id: id("u"), name: body.name, email: body.email.toLowerCase(), phone: body.phone, ...hash(body.password) };
    db.users.push(user);
    const token = crypto.randomBytes(24).toString("hex");
    db.sessions.push({ token, userId: user.id });
    writeDb(db);
    return send(res, 200, { user: userView(user) }, { "Set-Cookie": `ocune=${token}; HttpOnly; Path=/; SameSite=Lax` });
  }
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = JSON.parse(await readBody(req));
    const user = db.users.find((entry) => entry.email === String(body.email || "").toLowerCase());
    if (!user || hash(body.password || "", user.salt).digest !== user.digest) throw new Error("Email or password is wrong");
    const token = crypto.randomBytes(24).toString("hex");
    db.sessions.push({ token, userId: user.id });
    writeDb(db);
    return send(res, 200, { user: userView(user) }, { "Set-Cookie": `ocune=${token}; HttpOnly; Path=/; SameSite=Lax` });
  }
  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = cookies(req).ocune;
    db.sessions = db.sessions.filter((entry) => entry.token !== token);
    writeDb(db);
    return send(res, 200, { ok: true }, { "Set-Cookie": "ocune=; HttpOnly; Path=/; Max-Age=0" });
  }
  if (req.method === "POST" && url.pathname === "/api/me/bank") {
    if (!me) return send(res, 401, { error: "Log in first" });
    const body = JSON.parse(await readBody(req));
    me.bankCode = body.bankCode;
    me.accountNumber = body.accountNumber;
    me.accountName = body.accountName || me.name;
    writeDb(db);
    return send(res, 200, { user: userView(me) });
  }
  if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, { items: db.items.map(publicItem) });
  if (req.method === "POST" && url.pathname === "/api/items") {
    if (!me) return send(res, 401, { error: "Log in first" });
    const body = JSON.parse(await readBody(req));
    if (!body.title || !body.price || !body.city || !body.state || !body.address) throw new Error("Title, price, city, state, and address are required");
    const item = { id: id("d"), sellerId: me.id, sellerName: me.name, title: body.title, price: Number(body.price), city: body.city, state: body.state, address: body.address, phone: body.phone || me.phone, condition: body.condition || "Good", note: body.note || "", image: "images/shirt.jpg", hold: false };
    db.items.unshift(item);
    writeDb(db);
    return send(res, 200, { item: publicItem(item) });
  }
  const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (req.method === "GET" && itemMatch) {
    const item = db.items.find((entry) => entry.id === itemMatch[1]);
    if (!item) return send(res, 404, { error: "Item not found" });
    const order = db.orders.find((entry) => entry.itemId === item.id && entry.buyerId === me?.id && entry.status !== "refunded");
    const view = publicItem(item);
    if (order && order.status !== "pending") Object.assign(view, { phone: item.phone, address: item.address, orderId: order.id });
    return send(res, 200, { item: view });
  }
  if (req.method === "POST" && url.pathname === "/api/orders") {
    if (!me) return send(res, 401, { error: "Log in first" });
    const body = JSON.parse(await readBody(req));
    const item = db.items.find((entry) => entry.id === body.itemId);
    if (!item || item.hold) throw new Error("That item is not open");
    if (item.sellerId === me.id) throw new Error("You cannot buy your own item");
    const order = { id: id("o"), itemId: item.id, title: item.title, sellerId: item.sellerId, sellerName: item.sellerName, buyerId: me.id, buyerName: me.name, gross: item.price, fee: feeOf(item.price), net: item.price - feeOf(item.price), status: "pending", buyerOk: false, sellerOk: false };
    db.orders.unshift(order);
    const key = process.env.PAYSTACK_SECRET_KEY || SECRET;
    if (!key) {
      order.status = "held";
      item.hold = true;
      writeDb(db);
      return send(res, 200, { demo: true, orderId: order.id });
    }
    writeDb(db);
    const payment = await paystack("/transaction/initialize", { email: me.email, amount: item.price * 100, reference: order.id, callback_url: APP_URL + "/?paid=" + order.id, metadata: { orderId: order.id } });
    return send(res, 200, { url: payment.data.authorization_url });
  }
  if (req.method === "POST" && url.pathname === "/api/paystack/webhook") {
    const raw = await readBody(req);
    const key = process.env.PAYSTACK_SECRET_KEY || SECRET;
    const signature = req.headers["x-paystack-signature"];
    const expected = crypto.createHmac("sha512", key).update(raw).digest("hex");
    if (!key || signature !== expected) return send(res, 401, { error: "Bad signature" });
    const event = JSON.parse(raw.toString());
    if (event.event === "charge.success") {
      const order = db.orders.find((entry) => entry.id === event.data.reference);
      const item = order && db.items.find((entry) => entry.id === order.itemId);
      if (order && item && order.status === "pending") {
        order.status = "held";
        order.paidAt = new Date().toISOString();
        item.hold = true;
        writeDb(db);
      }
    }
    return send(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/api/orders") {
    if (!me) return send(res, 401, { error: "Log in first" });
    const orders = db.orders.filter((order) => order.buyerId === me.id || order.sellerId === me.id).map((order) => {
      const item = db.items.find((entry) => entry.id === order.itemId);
      const view = { ...order };
      if (order.buyerId === me.id && order.status !== "pending" && item) {
        view.phone = item.phone;
        view.address = item.address;
        view.city = item.city;
        view.state = item.state;
      }
      return view;
    });
    return send(res, 200, { orders });
  }
  const mark = url.pathname.match(/^\/api\/orders\/([^/]+)\/mark$/);
  if (req.method === "POST" && mark) {
    if (!me) return send(res, 401, { error: "Log in first" });
    const order = db.orders.find((entry) => entry.id === mark[1]);
    if (!order || order.status !== "held") throw new Error("That trade is not waiting on a mark");
    if (order.buyerId === me.id) order.buyerOk = true;
    else if (order.sellerId === me.id) order.sellerOk = true;
    else throw new Error("This is not your trade");
    if (order.buyerOk && order.sellerOk) await release(db, order);
    writeDb(db);
    return send(res, 200, { order });
  }
  return send(res, 404, { error: "No such route" });
}

server.listen(PORT, () => console.log("Ocune Declutter on " + APP_URL));
