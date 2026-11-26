
const SUPABASE_URL = "https://wufsozpzqnfekctvudfo.supabase.co";
const SUPABASE_KEY = "sb_publishable_UkwW-P2AMMOIUkNKwoO9DQ_bpdMTa1Q";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const view = document.getElementById("view");

let currentUser = null;
let currentTab = "rewards";
let registerMode = false;
let renderVersion = 0;

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
        <input name="password" type="password"
          minlength="8"
          autocomplete="${registerMode
            ? "new-password"
            : "current-password"}" required>

        <button class="bigbtn" type="submit">
          ${registerMode
            ? "Create account"
            : "Sign in"}
        </button>
      </form>

      <button class="secondary bigbtn" id="toggleauth">
        ${registerMode
          ? "Already a member? Sign in"
          : "New here? Join rewards"}
      </button>

      <p id="authmessage" role="status"
        class="muted"></p>
    </section>
  `;

  document.getElementById("toggleauth").onclick = () => {
    registerMode = !registerMode;
    showAuth();
  };

  document.getElementById("authform").onsubmit =
    async event => {
      event.preventDefault();

      const form = event.currentTarget;
      const data = new FormData(form);
      const button = form.querySelector("button");
      const message =
        document.getElementById("authmessage");

      button.disabled = true;
      message.textContent = "Please wait...";

      try {
        let response;

        if (registerMode) {
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
          message.textContent = response.error.message;
        } else if (registerMode && !response.data.session) {
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

  const [profile, wallet, history] = await Promise.all([
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
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  if (version !== renderVersion ||
      currentUser?.id !== userId) return;

  if (profile.error || wallet.error || history.error) {
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

    document.getElementById("retry").onclick = render;
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

    <section class="card">
      <h2>Your rewards card</h2>
      <p class="muted">
        Your digital rewards card is being prepared.
      </p>
    </section>

    <section class="card">
      <h2>Recent activity</h2>

      ${history.data.length
        ? history.data.map(t => `
          <p>
            <strong>
              ${new Date(t.created_at)
                .toLocaleDateString("en-AU")}
            </strong><br>
            Purchase: ${money(t.purchase_cents)}<br>
            Earned: ${money(t.earned_cents)}<br>
            Redeemed: ${money(t.redeemed_cents)}
          </p>
          <hr class="divider">
        `).join("")
        : `<p class="muted">
            Your reward transactions will appear here.
           </p>`
      }

      <button class="secondary bigbtn" id="refresh">
        Refresh balance
      </button>
    </section>

    <button class="secondary bigbtn" id="signout">
      Sign out
    </button>
  `;

  document.getElementById("refresh").onclick = render;
  wireSignout();
}

function wireSignout() {
  document.getElementById("signout").onclick =
    async () => {
      const { error } = await db.auth.signOut();

      if (error) {
        alert(error.message);
        return;
      }

      currentUser = null;
      currentTab = "rewards";
      registerMode = false;
      render();
    };
}

function render() {
  renderVersion++;

  document.querySelectorAll("[data-tab]")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.tab === currentTab
      );
    });

  if (currentTab === "rewards") {
    showRewards();
  } else if (currentTab === "events") {
    view.innerHTML = `
      <section class="card">
        <h2>What's on at Rafter & Rose</h2>
        <p>Discover our upcoming events and
        little moments worth celebrating.</p>
        <button class="bigbtn"
          onclick="location.href='https://rafterandrose.com/events.html'">
          Explore events
        </button>
      </section>
    `;
  } else if (currentTab === "cakes") {
    view.innerHTML = `
      <section class="card">
        <h2>Cake orders</h2>
        <p>Something sweet for your special occasion.</p>
        <button class="bigbtn"
          onclick="location.href='https://rafterandrose.com/cakes.html'">
          Explore cakes
        </button>
      </section>
    `;
  } else if (currentTab === "hire") {
    view.innerHTML = `
      <section class="card">
        <h2>Celebrate with us</h2>
        <p>Make our little garden café yours.</p>
        <button class="bigbtn"
          onclick="location.href='https://rafterandrose.com/private-hire.html'">
          Explore private hire
        </button>
      </section>
    `;
  } else if (currentTab === "staff") {
    view.innerHTML = `
      <section class="card">
        <h2>Staff portal</h2>
        <p>Staff checkout is not yet enabled.</p>
        <p class="muted">
          Internal setup and testing in progress.
        </p>
      </section>
    `;
  }
}

async function refreshSession() {
  const { data, error } = await db.auth.getSession();

  if (error) {
    view.textContent = error.message;
    return;
  }

  currentUser = data.session?.user || null;
  render();
}

document.querySelectorAll("[data-tab]")
  .forEach(button => {
    button.onclick = () => {
      currentTab = button.dataset.tab;
      render();
    };
  });

db.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  renderVersion++;
  setTimeout(render, 0);
});

refreshSession();
