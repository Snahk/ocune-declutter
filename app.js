const state = { view: "market", user: null, live: false, banks: [], items: [], orders: [], item: null, toast: "" };

async function api(path, options) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, credentials: "same-origin", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function naira(n) { return "₦" + Math.round(n).toLocaleString("en-NG"); }
function esc(value) { return String(value || "").replace(/&/g, "&").replace(/</g, "<"); }
function ping(message) { state.toast = message; render(); setTimeout(() => { state.toast = ""; render(); }, 2400); }

async function boot() {
  const me = await api("/api/me");
  state.user = me.user;
  state.live = me.live;
  state.banks = me.banks;
  state.items = (await api("/api/items")).items;
  if (state.user) state.orders = (await api("/api/orders")).orders;
  const paid = new URLSearchParams(location.search).get("paid");
  if (paid) { state.view = "trades"; history.replaceState(null, "", "/"); }
  render();
}

function shell(body) {
  const who = state.user ? `${esc(state.user.name)}` : "Log in";
  return `<header class="top"><button class="brand" data-go="market"><b>Ocune</b><span>Declutter desk</span></button><div class="right"><button class="who" data-go="${state.user ? "account" : "login"}">${who}</button></div></header>
  <div class="wrap tabs"><button class="who" data-go="market">Items</button><button class="who" data-go="list">List</button><button class="who" data-go="trades">Trades</button></div>
  ${state.live ? "" : `<div class="wrap tiny">Paystack key is not on this server yet. Signup and the steps work. A real card payment starts after the key is added.</div>`}
  ${body}
  <footer class="wrap">Both sides mark the trade. Paystack then sends 90% to the seller. Ocune keeps 10%.</footer>
  ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
}

function market() {
  const cards = state.items.map((item) => `<button class="card" data-open="${item.id}"><img src="${item.image}" alt=""><div><span class="pill ${item.hold ? "" : "live"}">${item.hold ? "Paid" : "Open"} · ${esc(item.condition)}</span><h3 style="font-size:22px;margin:6px 0">${esc(item.title)}</h3><div class="split"><span class="price">${naira(item.price)}</span><span class="tiny">${esc(item.city)}, ${esc(item.state)}</span></div></div></button>`).join("");
  return `<section class="wrap" style="padding:18px 0"><h2>Items</h2><p class="tiny">City and state only, until you pay.</p><div class="grid" style="margin-top:12px">${cards || "<p>No items yet.</p>"}</div></section>`;
}

function detail() {
  const item = state.item;
  if (!item) return `<section class="wrap"><p>Item not found.</p></section>`;
  const contact = item.address ? `<div class="card" style="padding:14px"><b>Seller contact</b><p>${esc(item.sellerName)}<br>${esc(item.phone)}<br>${esc(item.address)}</p></div>` : `<p class="tiny">Address and phone open after your payment is confirmed.</p>`;
  const pay = !item.hold && state.user ? `<button class="btn" data-pay="${item.id}">Pay with Paystack</button>` : "";
  const login = !state.user ? `<button class="btn" data-go="login">Log in to pay</button>` : "";
  return `<section class="wrap" style="padding:18px 0"><img src="${item.image}" alt="" style="border-radius:18px;max-height:360px;width:100%;object-fit:cover"><button class="text" data-go="market">← Items</button><h1 style="font-size:42px">${esc(item.title)}</h1><p class="price">${naira(item.price)}</p><p class="tiny">${esc(item.city)}, ${esc(item.state)} · ${esc(item.sellerName)}</p><p>${esc(item.note)}</p><div class="bar"><i></i><i></i></div><div class="split"><span>Seller ${naira(item.price * 0.9)}</span><span>Ocune ${naira(item.price * 0.1)}</span></div>${contact}<div class="row">${pay}${login}</div></section>`;
}

function authForm(mode) {
  const extra = mode === "signup" ? `<label>Name<input name="name" required></label><label>Phone<input name="phone" required></label>` : "";
  return `<section class="wrap" style="padding:22px 0"><h2>${mode === "signup" ? "Create an account" : "Log in"}</h2><form class="form card" style="padding:14px" data-auth="${mode}">${extra}<label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" required></label><button class="btn" type="submit">${mode === "signup" ? "Sign up" : "Log in"}</button></form><button class="text" data-go="${mode === "signup" ? "login" : "signup"}">${mode === "signup" ? "I already have an account" : "Create an account"}</button></section>`;
}

function listForm() {
  if (!state.user) return authForm("login");
  return `<section class="wrap" style="padding:22px 0"><h2>List a used item</h2><form class="form card" style="padding:14px" data-list><label>Item<input name="title" required></label><label>Price<input name="price" type="number" min="1000" required></label><label>City<input name="city" required></label><label>State<input name="state" required></label><label>Full address<input name="address" required></label><label>Pickup phone<input name="phone" value="${esc(state.user.phone)}" required></label><label>Note<textarea name="note" required></textarea></label><button class="btn">Publish</button></form></section>`;
}

function trades() {
  if (!state.user) return authForm("login");
  const lines = state.orders.map((order) => {
    const mine = order.buyerId === state.user.id ? order.buyerOk : order.sellerOk;
    const mark = order.status === "held" && !mine ? `<button class="btn" data-mark="${order.id}">Mark my side successful</button>` : "";
    const contact = order.address ? `<p>${esc(order.phone)}<br>${esc(order.address)}</p>` : "";
    return `<article class="card" style="padding:10px"><b>${esc(order.title)}</b><div class="tiny">${esc(order.status)} · buyer ${order.buyerOk ? "marked" : "waiting"} · seller ${order.sellerOk ? "marked" : "waiting"}</div><div class="tiny">Held ${naira(order.gross)} · seller ${naira(order.net)} · Ocune ${naira(order.fee)}</div>${contact}${mark}</article>`;
  }).join("");
  return `<section class="wrap" style="padding:22px 0"><h2>My trades</h2><div class="list">${lines || "<p class='tiny'>No trades yet.</p>"}</div></section>`;
}

function account() {
  if (!state.user) return authForm("login");
  const options = state.banks.map(([code, name]) => `<option value="${code}" ${code === state.user.bankCode ? "selected" : ""}>${name}</option>`).join("");
  return `<section class="wrap" style="padding:22px 0"><h2>${esc(state.user.name)}</h2><p class="tiny">${esc(state.user.email)} · ${esc(state.user.phone)}</p><form class="form card" style="padding:14px" data-bank><label>Bank<select name="bankCode">${options}</select></label><label>Account number<input name="accountNumber" value="${esc(state.user.accountNumber)}" required></label><label>Account name<input name="accountName" value="${esc(state.user.accountName)}" required></label><button class="btn">Save payout account</button></form><button class="text" data-logout>Log out</button></section>`;
}

function render() {
  const pages = { market, detail, login: () => authForm("login"), signup: () => authForm("signup"), list: listForm, trades, account };
  document.getElementById("app").innerHTML = shell((pages[state.view] || market)());
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.go) { state.view = button.dataset.go; return render(); }
  if (button.dataset.open) {
    state.item = (await api("/api/items/" + button.dataset.open)).item;
    state.view = "detail";
    return render();
  }
  if (button.dataset.pay) {
    const data = await api("/api/orders", { method: "POST", body: JSON.stringify({ itemId: button.dataset.pay }) });
    if (data.url) location.href = data.url;
    else { state.item = (await api("/api/items/" + button.dataset.pay)).item; state.orders = (await api("/api/orders")).orders; ping("Payment recorded in demo mode. Address is open."); render(); }
  }
  if (button.dataset.mark) {
    await api("/api/orders/" + button.dataset.mark + "/mark", { method: "POST", body: "{}" });
    state.orders = (await api("/api/orders")).orders;
    ping("Mark saved.");
    render();
  }
  if (button.dataset.logout) { await api("/api/logout", { method: "POST", body: "{}" }); state.user = null; state.view = "market"; render(); }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.auth) {
      state.user = (await api("/api/" + form.dataset.auth, { method: "POST", body: JSON.stringify(body) })).user;
      state.view = "market";
      ping("You are in.");
    }
    if (form.dataset.list) {
      await api("/api/items", { method: "POST", body: JSON.stringify(body) });
      state.items = (await api("/api/items")).items;
      state.view = "market";
      ping("Listed. Buyers can see city and state only.");
    }
    if (form.dataset.bank) {
      state.user = (await api("/api/me/bank", { method: "POST", body: JSON.stringify(body) })).user;
      ping("Payout account saved.");
    }
    render();
  } catch (err) { ping(err.message); }
});

boot();
