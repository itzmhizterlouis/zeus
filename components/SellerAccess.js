"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const defaultSignup = {
  businessName: "",
  country: "",
  email: "",
  fullName: "",
  password: "",
  phone: "",
};

const defaultLogin = {
  email: "",
  password: "",
};

function buildProfileState(initialSeller) {
  return {
    acceptTerms: false,
    accountHolderName: initialSeller?.accountHolderName || initialSeller?.fullName || "",
    accountNumber: "",
    bankName: initialSeller?.bankName || "",
    businessName: initialSeller?.businessName || "",
    businessLogoUrl: initialSeller?.businessLogoUrl || "",
    country: initialSeller?.country || "",
    identityType: initialSeller?.verificationType || "",
    identityValue: "",
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

async function uploadAsset(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/uploads/pinata", {
    body: formData,
    method: "POST",
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Upload failed.");
  }

  return data.file;
}

export default function SellerAccess({ initialMode, initialSeller }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [currentStep, setCurrentStep] = useState(0);
  const [signupForm, setSignupForm] = useState(defaultSignup);
  const [loginForm, setLoginForm] = useState(defaultLogin);
  const [otpForm, setOtpForm] = useState({ emailCode: "", phoneCode: "" });
  const [profileForm, setProfileForm] = useState(buildProfileState(initialSeller));
  const [sellerId, setSellerId] = useState(initialSeller?.id || "");
  const [otpPreview, setOtpPreview] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState(
    initialSeller
      ? "You are signed in. Finish identity and payout setup to unlock your dashboard."
      : ""
  );
  const [busy, setBusy] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [showSessionChoice, setShowSessionChoice] = useState(Boolean(initialSeller));
  const hasActiveSession = Boolean(initialSeller);
  const hasCompletedSession = Boolean(initialSeller?.onboardingCompleted);

  function updateSignupField(field, value) {
    setSignupForm((current) => ({ ...current, [field]: value }));
  }

  function updateLoginField(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }));
  }

  function updateOtpField(field, value) {
    setOtpForm((current) => ({ ...current, [field]: value }));
  }

  function updateProfileField(field, value) {
    setProfileForm((current) => ({ ...current, [field]: value }));
  }

  function resetNotices() {
    setErrorMessage("");
    setInfoMessage("");
  }

  async function handleBusinessLogoUpload(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploadingLogo(true);
    setErrorMessage("");

    try {
      const uploadedFile = await uploadAsset(file);
      updateProfileField("businessLogoUrl", uploadedFile.url);
      setInfoMessage("Business logo uploaded.");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      event.target.value = "";
      setUploadingLogo(false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    setBusy(true);
    resetNotices();

    try {
      const data = await postJson("/api/auth/seller/signup", signupForm);
      setSellerId(data.sellerId);
      setOtpPreview(data.devOtp);
      setCurrentStep(1);
      setMode("signup");
      setInfoMessage(data.message);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleOtpVerification(event) {
    event.preventDefault();
    setBusy(true);
    resetNotices();

    try {
      const data = await postJson("/api/auth/seller/verify-otp", {
        ...otpForm,
        sellerId,
      });
      setCurrentStep(2);
      setOtpPreview(null);
      setInfoMessage(data.message);
      setProfileForm((current) => ({
        ...current,
        accountHolderName: current.accountHolderName || data.seller.fullName,
        businessName: current.businessName || data.seller.businessName || "",
        country: current.country || data.seller.country || "",
      }));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteProfile(event) {
    event.preventDefault();
    setBusy(true);
    resetNotices();

    try {
      const data = await postJson("/api/auth/seller/complete-profile", profileForm);
      setCurrentStep(3);
      setInfoMessage(data.message);
      router.push("/seller/dashboard");
      router.refresh();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    resetNotices();

    try {
      const data = await postJson("/api/auth/seller/login", loginForm);

      if (data.nextStep === "otp") {
        setSellerId(data.sellerId);
        setOtpPreview(data.devOtp);
        setCurrentStep(1);
        setMode("login");
        setInfoMessage(data.message);
        return;
      }

      if (data.nextStep === "profile") {
        setInfoMessage(data.message);
        router.push("/seller");
        router.refresh();
        return;
      }

      setInfoMessage(data.message);
      router.push("/seller/dashboard");
      router.refresh();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitchAccount() {
    setBusy(true);
    resetNotices();

    try {
      await fetch("/api/auth/seller/logout", {
        method: "POST",
      });
      router.push(initialMode === "login" ? "/seller?mode=login" : "/seller");
      router.refresh();
    } catch (error) {
      setErrorMessage(error.message || "Unable to sign out right now.");
    } finally {
      setBusy(false);
    }
  }

  function handleContinueCurrentSession() {
    if (!initialSeller) {
      return;
    }

    if (initialSeller.onboardingCompleted) {
      router.push("/seller/dashboard");
      router.refresh();
      return;
    }

    setShowSessionChoice(false);
    setMode("resume");
    setCurrentStep(2);
    setInfoMessage("Continue completing your seller verification.");
  }

  const isLogin = mode === "login";
  const isResume = Boolean(initialSeller) || currentStep >= 2;

  return (
    <section className="workspace-stack">
      <div className="workspace-grid auth-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow accent-green">
                {showSessionChoice
                  ? "Active session"
                  : isLogin
                    ? "Vendor login"
                    : "Vendor signup"}
              </span>
              <h2>
                {showSessionChoice
                  ? "You already have an active vendor session"
                  : initialSeller
                  ? "Finish seller verification"
                  : isLogin
                    ? "Log in to your vendor account"
                    : currentStep === 1
                      ? "Verify your contact details"
                      : "Create a seller account"}
              </h2>
              {currentStep === 0 && !initialSeller ? (
                <p className="helper-text">
                  {isLogin ? (
                    <>
                      Need a vendor account?{" "}
                      <Link className="text-link" href="/seller">
                        Sign up as vendor
                      </Link>
                    </>
                  ) : (
                    <>
                      Already have an account?{" "}
                      <Link className="text-link" href="/seller?mode=login">
                        Log in
                      </Link>
                    </>
                  )}
                </p>
              ) : null}
            </div>
          </div>

          {errorMessage ? (
            <div className="message-banner message-banner-error">{errorMessage}</div>
          ) : null}

          {infoMessage ? (
            <div className="message-banner message-banner-info">{infoMessage}</div>
          ) : null}

          {showSessionChoice ? (
            <div className="content-stack">
              <div className="highlight-box highlight-box-light">
                <span className="highlight-label">Already signed in</span>
                <strong>{initialSeller.displayName}</strong>
                <p className="helper-text">
                  This browser already has an active vendor session. Continue with
                  this account or sign out first before creating or using another one.
                </p>
              </div>

              <div className="button-row">
                <button
                  className="button button-dark"
                  onClick={handleContinueCurrentSession}
                  type="button"
                >
                  {hasCompletedSession ? "Go to dashboard" : "Continue setup"}
                </button>
                <button
                  className="button button-light"
                  disabled={busy}
                  onClick={handleSwitchAccount}
                  type="button"
                >
                  {busy ? "Signing out..." : "Sign out and continue"}
                </button>
              </div>
            </div>
          ) : null}

          {!showSessionChoice && currentStep === 0 && !isLogin && (
            <form className="content-stack" onSubmit={handleSignup}>
              <div className="field-grid">
                <label className="field">
                  <span>Full name</span>
                  <input
                    className="input"
                    onChange={(event) => updateSignupField("fullName", event.target.value)}
                    value={signupForm.fullName}
                  />
                </label>

                <label className="field">
                  <span>Business name</span>
                  <input
                    className="input"
                    onChange={(event) => updateSignupField("businessName", event.target.value)}
                    value={signupForm.businessName}
                  />
                </label>

                <label className="field">
                  <span>Email address</span>
                  <input
                    className="input"
                    onChange={(event) => updateSignupField("email", event.target.value)}
                    type="email"
                    value={signupForm.email}
                  />
                </label>

                <label className="field">
                  <span>Phone number</span>
                  <input
                    className="input"
                    onChange={(event) => updateSignupField("phone", event.target.value)}
                    value={signupForm.phone}
                  />
                </label>

                <label className="field">
                  <span>Password</span>
                  <input
                    className="input"
                    onChange={(event) => updateSignupField("password", event.target.value)}
                    type="password"
                    value={signupForm.password}
                  />
                </label>

                <label className="field">
                  <span>Country</span>
                  <input
                    className="input"
                    onChange={(event) => updateSignupField("country", event.target.value)}
                    value={signupForm.country}
                  />
                </label>
              </div>

              <button className="button button-dark" disabled={busy} type="submit">
                {busy ? "Creating account..." : "Create seller account"}
              </button>
            </form>
          )}

          {!showSessionChoice && currentStep === 0 && isLogin && (
            <form className="content-stack" onSubmit={handleLogin}>
              <div className="field-grid">
                <label className="field field-full">
                  <span>Email address</span>
                  <input
                    className="input"
                    onChange={(event) => updateLoginField("email", event.target.value)}
                    type="email"
                    value={loginForm.email}
                  />
                </label>

                <label className="field field-full">
                  <span>Password</span>
                  <input
                    className="input"
                    onChange={(event) => updateLoginField("password", event.target.value)}
                    type="password"
                    value={loginForm.password}
                  />
                </label>
              </div>

              <button className="button button-dark" disabled={busy} type="submit">
                {busy ? "Logging in..." : "Log in"}
              </button>
            </form>
          )}

          {!showSessionChoice && currentStep === 1 && (
            <form className="content-stack" onSubmit={handleOtpVerification}>
              <div className="field-grid">
                <label className="field">
                  <span>Email OTP</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    onChange={(event) =>
                      updateOtpField("emailCode", event.target.value.replace(/[^\d]/g, ""))
                    }
                    value={otpForm.emailCode}
                  />
                </label>

                <label className="field">
                  <span>Phone OTP</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    onChange={(event) =>
                      updateOtpField("phoneCode", event.target.value.replace(/[^\d]/g, ""))
                    }
                    value={otpForm.phoneCode}
                  />
                </label>
              </div>

              {otpPreview ? (
                <div className="dev-code-grid">
                  <div className="dev-code-card">
                    <span>Email code</span>
                    <strong>{otpPreview.emailCode}</strong>
                  </div>
                  <div className="dev-code-card">
                    <span>Phone code</span>
                    <strong>{otpPreview.phoneCode}</strong>
                  </div>
                </div>
              ) : null}

              <div className="button-row">
                <Link
                  className="button button-light"
                  href={mode === "login" ? "/seller?mode=login" : "/seller"}
                >
                  Back
                </Link>
                <button className="button button-dark" disabled={busy} type="submit">
                  {busy ? "Verifying..." : "Verify codes"}
                </button>
              </div>
            </form>
          )}

          {!showSessionChoice && isResume && (
            <form className="content-stack" onSubmit={handleCompleteProfile}>
              <div className="field-grid">
                <label className="field">
                  <span>Business name</span>
                  <input
                    className="input"
                    onChange={(event) => updateProfileField("businessName", event.target.value)}
                    value={profileForm.businessName}
                  />
                </label>

                <label className="field">
                  <span>Country</span>
                  <input
                    className="input"
                    onChange={(event) => updateProfileField("country", event.target.value)}
                    value={profileForm.country}
                  />
                </label>

                <label className="field field-full">
                  <span>Business logo</span>
                  <input
                    className="input"
                    onChange={handleBusinessLogoUpload}
                    type="file"
                  />
                  <small className="field-note">
                    Optional. Upload your business logo so your seller profile feels more trusted.
                  </small>
                </label>

                {profileForm.businessLogoUrl ? (
                  <div className="highlight-box highlight-box-light field-full">
                    <span className="highlight-label">Uploaded business logo</span>
                    <a
                      className="text-link"
                      href={profileForm.businessLogoUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View uploaded logo
                    </a>
                  </div>
                ) : null}

                <label className="field">
                  <span>Identity type</span>
                  <select
                    className="input"
                    onChange={(event) => updateProfileField("identityType", event.target.value)}
                    value={profileForm.identityType}
                  >
                    <option value="">Select one</option>
                    <option value="BVN">BVN</option>
                    <option value="NIN">NIN</option>
                  </select>
                </label>

                <label className="field">
                  <span>BVN or NIN</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    onChange={(event) =>
                      updateProfileField(
                        "identityValue",
                        event.target.value.replace(/[^\d]/g, "")
                      )
                    }
                    value={profileForm.identityValue}
                  />
                </label>

                <label className="field">
                  <span>Bank name</span>
                  <input
                    className="input"
                    onChange={(event) => updateProfileField("bankName", event.target.value)}
                    value={profileForm.bankName}
                  />
                </label>

                <label className="field">
                  <span>Account number</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    onChange={(event) =>
                      updateProfileField(
                        "accountNumber",
                        event.target.value.replace(/[^\d]/g, "")
                      )
                    }
                    value={profileForm.accountNumber}
                  />
                </label>

                <label className="field field-full">
                  <span>Account holder name</span>
                  <input
                    className="input"
                    onChange={(event) =>
                      updateProfileField("accountHolderName", event.target.value)
                    }
                    value={profileForm.accountHolderName}
                  />
                </label>
              </div>

              <label className="checkbox-row">
                <input
                  checked={profileForm.acceptTerms}
                  onChange={() =>
                    updateProfileField("acceptTerms", !profileForm.acceptTerms)
                  }
                  type="checkbox"
                />
                <span>
                  I accept the seller escrow agreement, including the return rule
                  for rejected items that remain unused and untampered with.
                </span>
              </label>

              <button className="button button-dark" disabled={busy} type="submit">
                {busy || uploadingLogo
                  ? uploadingLogo
                    ? "Uploading logo..."
                    : "Finishing setup..."
                  : "Complete seller verification"}
              </button>
            </form>
          )}
        </article>

        <aside className="panel panel-dark sticky-panel">
          <div className="panel-header compact-header">
            <div>
              <span className="eyebrow accent-blue">Seller path</span>
              <h2>What gets unlocked</h2>
            </div>
          </div>

          <div className="list-stack">
            <div className="list-item">
              <strong>Verified seller profile</strong>
              <p>Contact checks, identity setup, and payout details are completed before selling begins.</p>
            </div>
            <div className="list-item">
              <strong>Focused dashboard</strong>
              <p>The workspace no longer ships with fake transaction data or noisy sample values.</p>
            </div>
            <div className="list-item">
              <strong>Protected release flow</strong>
              <p>Escrow still anchors the transaction once seller-side setup is complete.</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
