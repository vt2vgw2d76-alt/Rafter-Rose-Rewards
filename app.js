
const SUPABASE_URL =
  "https://wufsozpzqnfekctvudfo.supabase.co";
const SUPABASE_KEY =
  "sb_publishable_UkwW-P2AMO IUkNKwoO9DQ_bpdMTa1Q"
    .replace(" ", "");

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const view = document.getElementById("view");
const staffTab = document.querySelector(
  '[data-tab="staff"]'
);

let currentUser = null;
let currentTab = "rewards";
let registerMode = false;
let renderVersion = 0;
let isStaff = false;
let scanner = null;
let customer = null;
let busy = false;

const money = cents =>
  "$" + (Number(cents) / 100).toFixed(2);

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toCents(value) {
  const text = String(value).trim();

  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) {
    return NaN;
  }

  return Math.round(Number(text) * 100);
}

function pendingKey() {
  return "rr-pending-" + currentUser.id;
}

function getPending() {
  return JSON.parse(
    localStorage.getItem(pendingKey()) || "null"
  );
}

async function stopScanner() {
  if (!scanner) return;

  const active = scanner;
  scanner = null;

  try {
    await active.stop();
  } catch (error) {}

  try {
    active.clear();
  } catch (error) {}
}

async function checkStaff() {
  isStaff = false;

  if (!currentUser) return;

  const userId = currentUser.id;

  const { data, error } = await db
    .from("staff_members")
    .select("active")
    .eq("user_id", userId)
    .maybeSingle();

  if (currentUser?.id !== userId) return;

  isStaff = !error && data?.active === true;
}

function showAuth() {
  view.innerHTML = `
    <section class="card hero">
      <h2>Little moments, lovely rewards.</h2>
      <p>Earn 5% back on eligible spending
      at Rafter & Rose.</p>
    </section>

    <section class="card">
      <h2>${registerMode
        ? "Join our rewards"
        : "Welcome back"}</h2>

      <form id="authform">
        ${registerMode ? `
          <label>Your name</label>
          <input name="name"
            autocomplete="name" required>
        ` : ""}

        <label>Email address</label>
        <input name="email" type="email"
          autocomplete="email" required>

        <label>Password</label>
        <input name="password"
          type="password"
          minlength="8"
          autocomplete="${registerMode
            ? "new-password"
            : "current-password"}"
          required>

        <button class="bigbtn" type="submit">
          ${registerMode
            ? "Create account"
            : "Sign in"}
        </button>
      </form>

      <button class="secondary bigbtn"
        id="toggleauth">
        ${registerMode
          ? "Already a member? Sign in"
          : "New here? Join rewards"}
      </button>

      <p id="authmessage"
        role="status" class="muted"></p>
    </section>
  `;

  document.getElementById("toggleauth")
    .onclick = () => {
      registerMode = !registerMode;
      showAuth();
    };

  document.getElementById("authform")
    .onsubmit = async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const data = new FormData(form);
      const button = form.querySelector("button");
      const message =
        document.getElementById("authmessage");
      const toggle =
        document.getElementById("toggleauth");
      const joining = registerMode;

      button.disabled = true;
      toggle.disabled = true;
      message.textContent = "Please wait...";

      try {
        let response;

        if (joining) {
          response = await db.auth.signUp({
            email: data.get("email"),
            password: data.get("password"),
            options: {
              data: {
                full_name: data.get("name")
              },
              emailRedirectTo:
                "https://rewards.rafterandrose.com/"
            }
          });
        } else {
          response =
            await db.auth.signInWithPassword({
              email: data.get("email"),
              password: data.get("password")
            });
        }

        if (response.error) {
          message.textContent =
            response.error.message;
        } else if (joining &&
                   !response.data.session) {
          message.textContent =
            "Please check your email to confirm your account.";
        } else {
          await refreshSession();
        }
      } catch (error) {
        message.textContent =
          "Something went wrong. Please try again.";
      } finally {
        button.disabled = false;
        toggle.disabled = false;
      }
    };
}

async function showRewards() {
  if (!currentUser) {
    showAuth();
    return;
  }

  const version = renderVersion;
  const userId = currentUser.id;

  view.innerHTML = `
    <section class="card">
      <p>Loading your rewards...</p>
    </section>
  `;

  const [profile, wallet, history] =
    await Promise.all([
      db.from("profiles")
        .select("full_name")
        .eq("id", userId)
        .single(),

      db.from("loyalty_wallets")
        .select("balance_cents")
        .eq("user_id", userId)
        .single(),

      db.from("loyalty_transactions")
        .select(
          "purchase_cents,earned_cents,redeemed_cents,created_at"
        )
        .eq("customer_id", userId)
        .order("created_at", {
          ascending: false
        })
        .limit(20)
    ]);

  if (version !== renderVersion ||
      currentUser?.id !== userId) return;

  if (profile.error ||
      wallet.error ||
      history.error) {

    console.error(
      profile.error,
      wallet.error,
      history.error
    );

    view.innerHTML = `
      <section class="card">
        <h2>Rewards unavailable</h2>
        <p>We couldn't load your account.
        Please try again.</p>

        <button id="retry">Try again</button>
        <button class="secondary" id="signout">
          Sign out
        </button>
      </section>
    `;

    document.getElementById("retry")
      .onclick = render;

    wireSignout();
    return;
  }

  const name =
    profile.data.full_name || "lovely";

  view.innerHTML = `
    <section class="card hero">
      <p>Hello, ${esc(name)}!</p>
      <small>YOUR REWARD DOLLARS</small>

      <div class="balance">
        ${money(wallet.data.balance_cents)}
      </div>

      <p>Earn 5% back on eligible spending
      after reward redemption.</p>
    </section>

    <section class="card"
      style="text-align:center">
      <h2>Your rewards card</h2>

      <div id="customerqr"
        style="display:flex;
        justify-content:center;
        padding:20px 0">
      </div>

      <p class="muted">
        Show your code at the counter
        to earn or redeem rewards.
      </p>

      <details>
        <summary class="muted">
          Show manual customer code
        </summary>
        <p class="mini"
          style="overflow-wrap:anywhere">
          ${esc(userId)}
        </p>
        <button id="copycode"
          class="secondary">
          Copy code
        </button>
      </details>
    </section>

    <section class="card">
      <h2>Recent activity</h2>

      ${history.data.length
        ? history.data.map(t => `
          <p>
            <strong>
              ${new Date(t.created_at)
                .toLocaleDateString("en-AU")}
            </strong>
          </p>

          <div class="row">
            <span>Purchase</span>
            <span>
              ${money(t.purchase_cents)}
            </span>
          </div>

          <div class="row">
            <span>Rewards earned</span>
            <strong style="color:#53835b">
              +${money(t.earned_cents)}
            </strong>
          </div>

          <div class="row">
            <span>Rewards redeemed</span>
            <span>
              ${money(t.redeemed_cents)}
            </span>
          </div>

          <hr class="divider">
        `).join("")
        : `<p class="muted">
            Your reward transactions
            will appear here.
           </p>`}

      <button class="secondary bigbtn"
        id="refresh">
        Refresh balance
      </button>
    </section>

    <button class="secondary bigbtn"
      id="signout">
      Sign out
    </button>
  `;

  try {
    new QRCode(
      document.getElementById("customerqr"),
      {
        text: "RR:" + userId,
        width: 210,
        height: 210,
        colorDark: "#293f34",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      }
    );
  } catch (error) {
    document.getElementById("customerqr")
      .textContent =
        "QR unavailable. Use your manual code.";
  }

  document.getElementById("copycode")
    .onclick = async () => {
      try {
        await navigator.clipboard.writeText(userId);
        document.getElementById("copycode")
          .textContent = "Copied!";
      } catch (error) {
        alert("Please copy the code manually.");
      }
    };

  document.getElementById("refresh")
    .onclick = render;

  wireSignout();
}

async function showStaff() {
  if (!currentUser || !isStaff) {
    currentTab = "rewards";
    render();
    return;
  }

  customer = null;

  view.innerHTML = `
    <section class="card hero">
      <h2>Staff checkout</h2>
      <p>Scan a rewards card to get started.</p>
    </section>

    <section class="card">
      <h2>Find customer</h2>

      <button id="scan"
        class="bigbtn">
        Open QR scanner
      </button>

      <div id="reader"
        style="margin-top:15px"></div>

      <button id="stopscan"
        class="secondary bigbtn hidden">
        Close camera
      </button>

      <label>Manual customer code</label>
      <input id="manualcode"
        placeholder="Paste customer code"
        autocomplete="off">

      <button id="lookup"
        class="secondary bigbtn">
        Find customer
      </button>

      <p id="staffmessage"
        class="muted" role="status"></p>
    </section>

    <div id="checkout"></div>

    <button id="signout"
      class="secondary bigbtn">
      Sign out
    </button>
  `;

  wireSignout();

  let pending;

  try {
    pending = getPending();
  } catch (error) {
    document.getElementById("checkout")
      .textContent =
        "Transaction storage unavailable. Do not process payments.";
    document.getElementById("scan").disabled = true;
    document.getElementById("lookup").disabled = true;
    return;
  }

  if (pending) {
    document.getElementById("scan").disabled = true;
    document.getElementById("lookup").disabled = true;
    showPending(pending);
    return;
  }

  document.getElementById("scan")
    .onclick = startScanner;

  document.getElementById("stopscan")
    .onclick = async () => {
      await stopScanner();
      document.getElementById("stopscan")
        ?.classList.add("hidden");
      const button = document.getElementById("scan");
      if (button) button.disabled = false;
    };

  document.getElementById("lookup")
    .onclick = () => {
      lookupCustomer(
        document.getElementById("manualcode").value
      );
    };
}

async function startScanner() {
  if (scanner || busy || !isStaff) return;

  const version = renderVersion;
  const message =
    document.getElementById("staffmessage");
  const button =
    document.getElementById("scan");

  button.disabled = true;
  message.textContent = "Opening camera...";

  try {
    const active = new Html5Qrcode("reader");
    scanner = active;

    await active.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 220, height: 220 }
      },
      async decoded => {
        if (version !== renderVersion ||
            busy ||
            scanner !== active) return;

        await lookupCustomer(decoded);
      },
      () => {}
    );

    if (version !== renderVersion ||
        scanner !== active) {
      try {
        await active.stop();
        active.clear();
      } catch (error) {}
      return;
    }

    message.textContent =
      "Position the QR code inside the camera.";

    document.getElementById("stopscan")
      .classList.remove("hidden");

  } catch (error) {
    await stopScanner();

    if (version !== renderVersion) return;

    message.textContent =
      "Camera unavailable. Check camera permissions or enter the customer code manually.";

    button.disabled = false;
  }
}

async function lookupCustomer(raw) {
  if (!isStaff || busy) return;

  const message =
    document.getElementById("staffmessage");

  const code = String(raw)
    .trim()
    .replace(/^RR:/i, "");

  if (!uuidPattern.test(code)) {
    message.textContent =
      "Please enter a valid rewards customer code.";
    return;
  }

  if (getPending()) {
    message.textContent =
      "Resolve the previous transaction first.";
    return;
  }

  busy = true;
  customer = null;

  const version = renderVersion;

  document.getElementById("checkout")
    .innerHTML = "";

  message.textContent = "Finding customer...";

  try {
    await stopScanner();

    const { data, error } = await db.rpc(
      "lookup_loyalty_customer",
      { p_customer_id: code }
    );

    if (version !== renderVersion) return;

    if (error || !data) {
      message.textContent =
        error?.message || "Customer not found.";
      return;
    }

    customer = data;
    message.textContent = "Customer found.";
    showCheckout();

  } catch (error) {
    message.textContent =
      "Unable to load customer. Try again.";
  } finally {
    busy = false;

    if (version === renderVersion) {
      document.getElementById("scan")
        .disabled = false;

      document.getElementById("stopscan")
        .classList.add("hidden");
    }
  }
}

function showCheckout() {
  const checkout =
    document.getElementById("checkout");

  checkout.innerHTML = `
    <section class="card">
      <h2>${esc(customer.full_name ||
        "Rewards customer")}</h2>

      <p class="muted">Available rewards</p>

      <div class="balance">
        ${money(customer.balance_cents)}
      </div>

      <label>Eligible purchase total ($)</label>
      <input id="purchase"
        type="number"
        inputmode="decimal"
        min="0.01"
        step="0.01"
        placeholder="0.00">

      <label>Rewards to redeem ($)</label>
      <input id="redeem"
        type="number"
        inputmode="decimal"
        min="0"
        step="0.01"
        value="0.00">

      <button id="maxredeem"
        class="secondary bigbtn">
        Use maximum available rewards
      </button>

      <hr class="divider">

      <div id="calculation"></div>

      <button id="confirm"
        class="bigbtn" disabled>
        Confirm rewards transaction
      </button>

      <p id="transactionmessage"
        class="muted" role="status"></p>
    </section>
  `;

  document.getElementById("purchase")
    .oninput = calculateCheckout;

  document.getElementById("redeem")
    .oninput = calculateCheckout;

  document.getElementById("maxredeem")
    .onclick = () => {
      const purchase = toCents(
        document.getElementById("purchase").value
      );

      if (!Number.isFinite(purchase)) return;

      document.getElementById("redeem").value =
        (Math.min(
          purchase,
          customer.balance_cents
        ) / 100).toFixed(2);

      calculateCheckout();
    };

  document.getElementById("confirm")
    .onclick = submitTransaction;

  calculateCheckout();
}

function checkoutAmounts() {
  const purchase = toCents(
    document.getElementById("purchase").value
  );

  const redeemed = toCents(
    document.getElementById("redeem").value
  );

  if (
    !customer ||
    !Number.isInteger(purchase) ||
    !Number.isInteger(redeemed) ||
    purchase <= 0 ||
    redeemed < 0 ||
    redeemed > purchase ||
    redeemed > customer.balance_cents
  ) return null;

  const paid = purchase - redeemed;

  const earned =
    Math.floor((paid * 5 + 50) / 100);

  return {
    purchase,
    redeemed,
    paid,
    earned,
    balance:
      customer.balance_cents - redeemed + earned
  };
}

function calculateCheckout() {
  const amounts = checkoutAmounts();

  const calculation =
    document.getElementById("calculation");

  const button =
    document.getElementById("confirm");

  button.disabled = !amounts || busy;

  if (!amounts) {
    calculation.innerHTML = `
      <p class="muted">
        Enter a valid purchase and redemption amount.
      </p>
    `;
    return;
  }

  calculation.innerHTML = `
    <div class="row">
      <span>Amount payable</span>
      <h2>${money(amounts.paid)}</h2>
    </div>

    <div class="row">
      <span>Rewards earned</span>
      <strong style="color:#53835b">
        +${money(amounts.earned)}
      </strong>
    </div>

    <hr class="divider">

    <div class="row">
      <span>Estimated new balance</span>
      <strong>${money(amounts.balance)}</strong>
    </div>

    <p class="muted">
      Confirm only after the corresponding
      payment or redemption is completed
      in Lightspeed.
    </p>
  `;
}

async function submitTransaction() {
  if (busy || !isStaff || !customer) return;

  const amounts = checkoutAmounts();

  if (!amounts || getPending()) return;

  const approved = window.confirm(
    "Confirm rewards transaction?\n\n" +
    "Purchase: " + money(amounts.purchase) +
    "\nRedeemed: " + money(amounts.redeemed) +
    "\nPaid: " + money(amounts.paid)
  );

  if (!approved) return;

  const pending = {
    p_customer_id: customer.customer_id,
    p_purchase_cents: amounts.purchase,
    p_redeemed_cents: amounts.redeemed,
    p_transaction_id: crypto.randomUUID()
  };

  try {
    localStorage.setItem(
      pendingKey(),
      JSON.stringify(pending)
    );
  } catch (error) {
    alert("Unable to save transaction reference. Do not proceed.");
    return;
  }

  await processPending(pending);
}

function showPending(pending, errorMessage = "") {
  document.getElementById("checkout")
    .innerHTML = `
      <section class="card">
        <h2>Pending transaction</h2>

        <p>
          A previous transaction has not
          been confirmed by the app.
        </p>

        <div class="notice">
          Do not create a new transaction
          for this purchase.
        </div>

        <p>Purchase:
          ${money(pending.p_purchase_cents)}</p>

        <p>Redeemed:
          ${money(pending.p_redeemed_cents)}</p>

        <p class="mini"
          style="overflow-wrap:anywhere">
          Reference:
          ${esc(pending.p_transaction_id)}
        </p>

        <p class="muted">
          ${esc(errorMessage)}
        </p>

        <button class="bigbtn"
          id="retrypending">
          Retry same transaction
        </button>

        <p class="muted">
          If the transaction was already
          processed, ask a manager to verify
          the original reference before
          proceeding.
        </p>
      </section>
    `;

  document.getElementById("retrypending")
    .onclick = () => processPending(pending);
}

async function processPending(pending) {
  if (busy || !isStaff || !currentUser) return;

  busy = true;

  const key = pendingKey();
  const version = renderVersion;

  document.querySelectorAll(
    "button, input"
  ).forEach(element => {
    element.disabled = true;
  });

  try {
    await stopScanner();

    const { data, error } = await db.rpc(
      "process_loyalty_transaction",
      pending
    );

    if (error || !data) {
      throw new Error(
        error?.message || "No confirmation received."
      );
    }

    localStorage.removeItem(key);

    if (version !== renderVersion) return;

    view.innerHTML = `
      <section class="card">
        <div class="notice good">
          Rewards transaction completed
        </div>

        <h2>All done!</h2>

        <p>Rewards earned:
          ${money(data.earned_cents)}</p>

        <p>Rewards redeemed:
          ${money(data.redeemed_cents)}</p>

        <p class="muted">
          Customer can refresh their balance
          to view the updated rewards.
        </p>

        <button id="nextcustomer"
          class="bigbtn">
          Next customer
        </button>

        <button id="signout"
          class="secondary bigbtn">
          Sign out
        </button>
      </section>
    `;

    document.getElementById("nextcustomer")
      .onclick = render;

    wireSignout();

  } catch (error) {
    if (version === renderVersion) {
      showPending(pending, error.message);
    }
  } finally {
    busy = false;

    document.querySelectorAll(
      "[data-tab], #signout, #retrypending"
    ).forEach(element => {
      element.disabled = false;
    });
  }
}

function wireSignout() {
  document.getElementById("signout")
    .onclick = async () => {
      if (busy) return;

      await stopScanner();

      const { error } = await db.auth.signOut();

      if (error) {
        alert(error.message);
        return;
      }

      currentUser = null;
      isStaff = false;
      customer = null;
      currentTab = "rewards";
      registerMode = false;

      render();
    };
}

async function render() {
  if (busy) return;

  const version = ++renderVersion;

  await stopScanner();

  if (version !== renderVersion) return;

  if (!isStaff && currentTab === "staff") {
    currentTab = "rewards";
  }

  staffTab.hidden = !isStaff;
  staffTab.style.display =
    isStaff ? "" : "none";

  document.querySelectorAll("[data-tab]")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.tab === currentTab
      );
    });

  if (currentTab === "staff") {
    await showStaff();
  } else {
    await showRewards();
  }
}

async function refreshSession() {
  const { data, error } =
    await db.auth.getSession();

  if (error) {
    view.textContent = error.message;
    return;
  }

  currentUser = data.session?.user || null;

  await checkStaff();

  currentTab = isStaff ? "staff" : "rewards";

  await render();
}

document.querySelectorAll("[data-tab]")
  .forEach(button => {
    button.onclick = () => {
      if (busy) return;

      currentTab = button.dataset.tab;
      render();
    };
  });

staffTab.style.display = "none";

db.auth.onAuthStateChange((_event, session) => {
  const nextUser = session?.user || null;

  if (nextUser?.id === currentUser?.id) return;

  currentUser = nextUser;
  isStaff = false;
  renderVersion++;

  setTimeout(refreshSession, 0);
});

refreshSession();
