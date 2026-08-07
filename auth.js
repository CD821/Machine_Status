import { remoteStore } from "./db.js";

const form = document.querySelector("#loginForm");
const message = document.querySelector("#loginMessage");

if (!remoteStore.isEnabled()) {
  message.textContent = "Authentication is not configured yet. Add Clerk keys in config.js or Vercel environment variables.";
}

if (remoteStore.provider === "clerk") {
  form.querySelectorAll("label").forEach((label) => {
    label.hidden = true;
  });
  form.querySelectorAll("input").forEach((input) => {
    input.required = false;
    input.disabled = true;
  });
  form.querySelector("button").textContent = "Sign in with Clerk";
}

if (await remoteStore.isSignedIn()) {
  location.href = "./index.html";
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  message.textContent = "Signing in...";
  try {
    await remoteStore.signIn(String(data.get("email") || ""), String(data.get("password") || ""));
    if (remoteStore.provider !== "clerk") {
      location.href = "./index.html";
    }
  } catch (error) {
    message.textContent = "Sign in failed. Check authentication settings.";
  }
});
