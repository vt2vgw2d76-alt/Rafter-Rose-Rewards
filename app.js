
const SUPABASE_URL =
  "https://wufsozpzqnfekctvudfo.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_UkwW-P2AMMOIUkNKwoO9DQ_bpdMTa1Q";

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
let activeCode = null;
let codeTimer = null;

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
  const pending = JSON.parse(
    localStorage.getItem(pendingKey()) || "null"
  );

  if (pending && (
    !uuidPattern.test(pending.p_customer_id) ||
    !uuidPattern.test(pending.p_transaction_id) ||
    !Number.isInteger(pending.p_purchase_cents) ||
    !Number.isInteger(pending.p_redeemed_cents) ||
    pending.p_purchase_cents <= 0 ||
    pending.p_redeemed_cents < 0 ||
    pending.p_redeemed_cents >
      pending.p_purchase_cents
  )) {
    throw new Error("Invalid pending transaction.");
  }

  return pending;
}

function clearRedemptionCode() {
  clearInterval(codeTimer);
  codeTimer = null;
  activeCode = null;

  const display =
    document.getElementById("redemptiondisplay");

  if (display) display.textContent = "";
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
        Show your rewards card at the counter
        whenever you make a purchase.
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

    <section class="card"
      style="text-align:center">

      <h2>Redeem your rewards</h2>

      <p class="muted">
        Generate a secure code when you're
        ready to spend your reward dollars.
      </p>

      <button class="bigbtn"
        id="generatecode"
        ${wallet.data.balance_cents <= 0
          ? "disabled" : ""}>
        Redeem my rewards
      </button>

      ${wallet.data.balance_cents <= 0
        ? `<p class="muted">
            You don't have any rewards
            available to redeem yet.
           </p>`
        : ""}

      <div id="redemptiondisplay"
        role="status"></div>
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
            <span>${money(t.purchase_cents)}</span>
          </div>

          <div class="row">
            <span>Rewards earned</span>
            <strong style="color:#53835b">
              +${money(t.earned_cents)}
            </strong>
          </div>

          <div class="row">
            <span>Rewards redeemed</span>
            <span>${money(t.redeemed_cents)}</span>
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

        const button =
          document.getElementById("copycode");

        if (button) button.textContent = "Copied!";
      } catch (error) {
        alert("Please copy the code manually.");
      }
    };

  document.getElementById("generatecode")
    .onclick = generateRedemptionCode;

  document.getElementById("refresh")
    .onclick = render;

  if (activeCode?.userId === userId &&
      activeCode.expires > Date.now()) {
    displayRedemptionCode();
  }

  wireSignout();
}

async function generateRedemptionCode() {
  const button =
    document.getElementById("generatecode");
  const display =
    document.getElementById("redemptiondisplay");

  const userId = currentUser?.id;
  const version = renderVersion;

  if (!userId || button.disabled) return;

  button.disabled = true;
  display.textContent = "Generating your code...";

  try {
    const { data, error } = await db.rpc(
      "generate_redemption_code"
    );

    if (version !== renderVersion ||
        currentUser?.id !== userId) return;

    if (error || data?.success !== true) {
      throw new Error(
        error?.message ||
        data?.error ||
        "Unable to generate code."
      );
    }

    const expires =
      new Date(data.expires_at).getTime();

    if (!/^[0-9]{6}$/.test(data.code) ||
        !Number.isFinite(expires)) {
      throw new Error("Invalid redemption response.");
    }

    activeCode = {
      userId,
      code: data.code,
      expires
    };

    displayRedemptionCode();

  } catch (error) {
    if (version !== renderVersion ||
        currentUser?.id !== userId) return;

    display.textContent = error.message;
    button.disabled = false;
  }
}

function displayRedemptionCode() {
  clearInterval(codeTimer);

  const display =
    document.getElementById("redemptiondisplay");

  const button =
    document.getElementById("generatecode");

  if (!display || !button || !activeCode) return;

  const code = activeCode;

  button.disabled = true;

  display.innerHTML = `
    <div style="
      margin-top:20px;
      padding:20px;
      background:#f8f4ec;
      border-radius:12px">

      <p>Your redemption code</p>

      <div style="
        font-size:38px;
        font-weight:700;
        letter-spacing:6px;
        color:#293f34">
        ${esc(code.code)}
      </div>

      <p id="codecountdown"
        class="muted"></p>

      <p class="muted">
        Show this code to your barista only
        when you're ready to redeem rewards.
        Confirm the amount being redeemed.
      </p>

      <small>
        Valid for one redemption only.
      </small>
    </div>
  `;

  const countdown =
    document.getElementById("codecountdown");

  const tick = () => {
    if (!display.isConnected ||
        currentUser?.id !== code.userId ||
        activeCode !== code) {
      clearInterval(codeTimer);
      codeTimer = null;
      return;
    }

    const seconds = Math.max(
      0,
      Math.ceil(
        (code.expires - Date.now()) / 1000
      )
    );

    if (seconds === 0) {
      clearRedemptionCode();

      display.textContent =
        "Your redemption code has expired.";

      button.disabled = false;
      return;
    }

    countdown.textContent =
      "Expires in " +
      Math.floor(seconds / 60) +
      ":" +
      String(seconds % 60).padStart(2, "0");
  };

  codeTimer = setInterval(tick, 1000);
  tick();
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

      <button id="scan" class="bigbtn">
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
        "Transaction storage unavailable. Ask a manager.";

    document.getElementById("scan").disabled = true;
    document.getElementById("lookup").disabled = true;
    return;
  }

  if (pending) {
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

      const button =
        document.getElementById("scan");

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

  try {
    if (getPending()) return;
  } catch (error) {
    alert("Transaction storage unavailable.");
    return;
  }

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
      "Camera unavailable. Check permissions or enter the customer code manually.";

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

  try {
    if (getPending()) {
      message.textContent =
        "Resolve the previous transaction first.";
      return;
    }
  } catch (error) {
    message.textContent =
      "Transaction storage unavailable.";
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

      if (document.getElementById("confirm")) {
        calculateCheckout();
      }
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
        type="number" inputmode="decimal"
        min="0.01" step="0.01"
        placeholder="0.00">

      <label>Rewards to redeem ($)</label>

      <input id="redeem"
        type="number" inputmode="decimal"
        min="0" step="0.01"
        value="0.00">

      <button id="maxredeem"
        class="secondary bigbtn">
        Use maximum available rewards
      </button>

      <div id="redemptionfield" hidden
        style="margin-top:15px">

        <div class="notice">
          Ask the customer to generate
          a redemption code and confirm
          the amount being redeemed.
        </div>

        <label>Customer redemption code</label>

        <input id="redemptioncode"
          type="text"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          placeholder="6-digit code">

        <p class="muted">
          Codes expire after two minutes
          and can only be used once.
        </p>
      </div>

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

  document.getElementById("redemptioncode")
    .oninput = event => {
      event.target.value = event.target.value
        .replace(/\D/g, "").slice(0, 6);

      calculateCheckout();
    };

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

  const field =
    document.getElementById("redemptionfield");

  const codeInput =
    document.getElementById("redemptioncode");

  const redeemed = toCents(
    document.getElementById("redeem").value
  );

  const needsCode = redeemed > 0;

  field.hidden = !needsCode;

  if (!needsCode) codeInput.value = "";

  const validCode =
    !needsCode ||
    /^[0-9]{6}$/.test(codeInput.value);

  button.disabled =
    !amounts || !validCode || busy;

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

    ${needsCode && !validCode
      ? `<p class="muted">
          Enter the customer's six-digit
          redemption code to continue.
         </p>`
      : ""}

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

  if (!amounts) return;

  const code = amounts.redeemed > 0
    ? document.getElementById(
        "redemptioncode"
      ).value.trim()
    : null;

  if (amounts.redeemed > 0 &&
      !/^[0-9]{6}$/.test(code)) return;

  try {
    if (getPending()) {
      showPending(getPending());
      return;
    }
  } catch (error) {
    alert("Transaction storage unavailable.");
    return;
  }

  const approved = window.confirm(
    "Confirm rewards transaction?\n\n" +
    "Purchase: " + money(amounts.purchase) +
    "\nRedeemed: " + money(amounts.redeemed) +
    "\nPaid: " + money(amounts.paid) +
    "\n\nConfirm the corresponding Lightspeed payment."
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
    alert(
      "Unable to save transaction reference. Do not proceed."
    );
    return;
  }

  document.getElementById(
    "redemptioncode"
  ).value = "";

  await processPending(pending, code);
}

function showPending(
  pending,
  errorMessage = "",
  confirmedRejection = false
) {
  document.getElementById("scan")
    ?.setAttribute("disabled", "");

  document.getElementById("lookup")
    ?.setAttribute("disabled", "");

  document.getElementById("manualcode")
    ?.setAttribute("disabled", "");

  const needsCode = pending.p_redeemed_cents > 0;

  document.getElementById("checkout")
    .innerHTML = `
      <section class="card">

        <h2>${confirmedRejection
          ? "Transaction not completed"
          : "Pending transaction"}</h2>

        <p>${confirmedRejection
          ? "Supabase rejected this attempt. No rewards were changed by this attempt."
          : "The app has not received confirmation of this transaction."}</p>

        <div class="notice">
          Do not create a new rewards
          transaction or repeat the Lightspeed
          payment for this purchase.
        </div>

        <p>Purchase:
          ${money(pending.p_purchase_cents)}</p>

        <p>Redeemed:
          ${money(pending.p_redeemed_cents)}</p>

        <p>Amount paid:
          ${money(
            pending.p_purchase_cents -
            pending.p_redeemed_cents
          )}</p>

        <p class="mini"
          style="overflow-wrap:anywhere">
          Reference:
          ${esc(pending.p_transaction_id)}
        </p>

        <p class="muted" role="status">
          ${esc(errorMessage)}
        </p>

        <button class="secondary bigbtn"
          id="checkpending">
          Check previous transaction
        </button>

        ${needsCode ? `
          <label>Customer redemption code</label>

          <input id="retrycode"
            type="text"
            inputmode="numeric"
            maxlength="6"
            autocomplete="off"
            placeholder="6-digit code">

          <p class="muted">
            If the previous attempt did not
            complete, ask the customer for
            a valid redemption code.
          </p>
        ` : ""}

        <button class="bigbtn"
          id="retrypending"
          ${needsCode ? "disabled" : ""}>
          Retry same transaction
        </button>

        <details>
          <summary>Manager cancellation</summary>
          <p class="muted">Only cancel after reconciling the original payment and rewards discount in Lightspeed. Completed transactions must be reversed instead.</p>
          <form id="cancelpendingform">
            <label for="cancelreason">Cancellation reason</label>
            <textarea id="cancelreason" required maxlength="500"></textarea>
            <label for="cancelpin">Manager PIN</label>
            <input id="cancelpin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required>
            <label><input id="cancelpos" type="checkbox" style="width:auto" required> Lightspeed reconciled</label>
            <button class="secondary bigbtn" type="submit">Permanently cancel original reference</button>
          </form>
        </details>
        <p id="pendingmessage"
          class="muted" role="status"></p>

        <p class="muted">
          If this transaction cannot be
          resolved, ask a manager to review
          its reference before proceeding.
        </p>
      </section>
    `;

  document.getElementById("checkpending")
    .onclick = () => checkPending(pending);

  document.getElementById("cancelpendingform").onsubmit = event => cancelPending(event, pending);

  if (needsCode) {
    document.getElementById("retrycode")
      .oninput = event => {
        event.target.value = event.target.value
          .replace(/\D/g, "").slice(0, 6);

        document.getElementById("retrypending")
          .disabled =
            !/^[0-9]{6}$/.test(
              event.target.value
            ) || busy;
      };
  }

  document.getElementById("retrypending")
    .onclick = () => {
      const input =
        document.getElementById("retrycode");

      const code = input?.value.trim() || null;

      if (needsCode &&
          !/^[0-9]{6}$/.test(code || "")) return;

      if (input) input.value = "";

      if (!window.confirm(
        "Retry the original rewards transaction? Do not repeat the Lightspeed payment."
      )) return;

      processPending(pending, code);
    };
}

async function checkPending(pending) {
  if (busy || !currentUser || !isStaff) return;

  busy = true;

  const version = renderVersion;
  const userId = currentUser.id;
  const key = pendingKey();

  const message =
    document.getElementById("pendingmessage");

  const button =
    document.getElementById("checkpending");

  const retry =
    document.getElementById("retrypending");

  button.disabled = true;
  retry.disabled = true;

  message.textContent =
    "Checking the original reference...";

  try {
    const { data, error } = await db.rpc(
      "get_loyalty_transaction_status", pending
    );
    if (version !== renderVersion || currentUser?.id !== userId) return;
    if (error || data?.success !== true) {
      throw new Error(error?.message || data?.error || "Unable to check status.");
    }
    if (data.transaction_id !== pending.p_transaction_id) {
      throw new Error("Transaction reference mismatch.");
    }
    if (data.status === "unresolved") {
      message.textContent = "No definitive record. Retry only the original reference, or ask a manager to cancel after checking Lightspeed.";
      return;
    }
    if (!["completed", "cancelled", "reversed"].includes(data.status) ||
        data.customer_id !== pending.p_customer_id ||
        data.purchase_cents !== pending.p_purchase_cents ||
        data.redeemed_cents !== pending.p_redeemed_cents) {
      throw new Error("Unexpected transaction status or details.");
    }
    localStorage.removeItem(key);
    if (data.status === "completed") showTransactionSuccess(data);
    else showResolvedPending(data.status);

  } catch (error) {
    if (version === renderVersion) {
      message.textContent =
        "Unable to verify transaction. " +
        error.message;
    }
  } finally {
    busy = false;

    if (button.isConnected) {
      button.disabled = false;

      const code =
        document.getElementById("retrycode");

      retry.disabled =
        pending.p_redeemed_cents > 0 &&
        !/^[0-9]{6}$/.test(
          code?.value || ""
        );
    }
  }
}

function showResolvedPending(status) {
  view.innerHTML = `<section class="card"><h2>Transaction ${esc(status)}</h2><p>The server confirmed this reference is ${esc(status)}. Do not retry it or repeat the original payment.</p><button id="nextcustomer" class="bigbtn">Next customer</button><button id="signout" class="secondary bigbtn">Sign out</button></section>`;
  document.getElementById("nextcustomer").onclick = render;
  wireSignout();
}

async function cancelPending(event, pending) {
  event.preventDefault();
  if (busy || !isStaff || !currentUser) return;
  const userId = currentUser.id;
  const version = renderVersion;
  const key = pendingKey();
  const form = event.currentTarget;
  const pin = form.querySelector("#cancelpin");
  const reason = form.querySelector("#cancelreason").value.trim();
  const confirmed = form.querySelector("#cancelpos").checked;
  if (!reason || !confirmed || !/^[0-9]{6}$/.test(pin.value)) return;
  if (!window.confirm("Permanently cancel this rewards reference?")) { pin.value = ""; return; }
  const args = {...pending, p_original_staff_id:userId, p_reason:reason, p_pos_confirmed:confirmed, p_manager_pin:pin.value};
  pin.value = "";
  busy = true;
  const button = form.querySelector("button");
  button.disabled = true;
  const message = document.getElementById("pendingmessage");
  try {
    const {data,error} = await db.rpc("cancel_loyalty_transaction", args);
    if (version !== renderVersion || currentUser?.id !== userId) return;
    if (error || data?.success !== true || data.transaction_id !== pending.p_transaction_id) throw new Error(error?.message || data?.error || "Cancellation not confirmed.");
    localStorage.removeItem(key);
    showResolvedPending("cancelled");
  } catch (error) {
    if (version === renderVersion && currentUser?.id === userId) message.textContent = error.message + " Check the original transaction status before proceeding.";
  } finally {
    args.p_manager_pin = "";
    busy = false;
    button.disabled = false;
    if (currentUser?.id !== userId) setTimeout(refreshSession, 0);
  }
}

function showTransactionSuccess(data) {
  view.innerHTML = `
    <section class="card">

      <div class="notice good">
        Rewards transaction completed
      </div>

      <h2>All done!</h2>

      ${data.already_processed
        ? `<p class="muted">
            Original transaction recovered.
            No duplicate rewards were awarded.
           </p>`
        : ""}

      <p>Rewards earned:
        ${money(data.earned_cents)}</p>

      <p>Rewards redeemed:
        ${money(data.redeemed_cents)}</p>

      <p>Balance after this transaction:
        <strong>${money(data.balance_cents)}</strong>
      </p>

      <p class="muted">
        Customer can refresh their balance
        to view their latest rewards.
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
}

async function processPending(
  pending,
  redemptionCode = null
) {
  if (busy || !isStaff || !currentUser) return;

  busy = true;

  const key = pendingKey();
  const version = renderVersion;
  const userId = currentUser.id;

  document.querySelectorAll(
    "button, input"
  ).forEach(element => {
    element.disabled = true;
  });

  try {
    await stopScanner();

    const { data, error } = await db.rpc(
      "process_loyalty_transaction",
      {
        ...pending,
        p_redemption_code: redemptionCode
      }
    );

    redemptionCode = null;

    if (version !== renderVersion ||
        currentUser?.id !== userId) return;

    if (error || !data) {
      throw new Error(
        error?.message ||
        "No confirmation received."
      );
    }

    if (data.success === false) {
      if ((data.cancelled === true || data.reversed === true) && data.transaction_id === pending.p_transaction_id) {
        localStorage.removeItem(key);
        showResolvedPending(data.cancelled ? "cancelled" : "reversed");
        return;
      }
      let message =
        data.error || "Transaction rejected.";

      if (Number.isInteger(
        data.attempts_remaining
      )) {
        message +=
          " Attempts remaining: " +
          data.attempts_remaining + ".";
      }

      showPending(pending, message, true);
      return;
    }

    if (data.success !== true ||
        data.transaction_id !==
          pending.p_transaction_id ||
        data.purchase_cents !==
          pending.p_purchase_cents ||
        data.redeemed_cents !==
          pending.p_redeemed_cents) {
      throw new Error(
        "Unexpected transaction response."
      );
    }

    localStorage.removeItem(key);

    showTransactionSuccess(data);

  } catch (error) {
    if (version === renderVersion &&
        currentUser?.id === userId) {
      showPending(pending, error.message);
    }
  } finally {
    redemptionCode = null;
    busy = false;

    document.querySelectorAll(
      "[data-tab], #signout, #checkpending, #retrycode"
    ).forEach(element => {
      element.disabled = false;
    });

    const retry =
      document.getElementById("retrypending");

    if (retry) {
      retry.disabled =
        pending.p_redeemed_cents > 0 &&
        !/^[0-9]{6}$/.test(
          document.getElementById("retrycode")
            ?.value || ""
        );
    }

    if (currentUser?.id !== userId) {
      setTimeout(refreshSession, 0);
    }
  }
}

function wireSignout() {
  const button =
    document.getElementById("signout");

  if (!button) return;

  button.onclick = async () => {
    if (busy) return;

    clearRedemptionCode();
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

  clearInterval(codeTimer);
  codeTimer = null;

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

  const nextUser = data.session?.user || null;

  if (currentUser?.id !== nextUser?.id) {
    clearRedemptionCode();
    customer = null;
  }

  currentUser = nextUser;

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

  clearRedemptionCode();

  currentUser = nextUser;
  isStaff = false;
  customer = null;
  renderVersion++;

  if (!busy) {
    view.textContent = "Loading...";
    setTimeout(refreshSession, 0);
  }
});

refreshSession();
