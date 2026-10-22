import { useEffect, useState } from "react";
import { CheckCircle2, Circle, KeyRound, Save, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { Btn, Card, CardHeader, Input, PageHeader } from "./UI";
import { isApiError } from "../../../lib/api";
import { updateStoredUser } from "../../../lib/auth";
import {
  PASSWORD_RULES,
  getMyProfile,
  isValidPhone,
  roleDisplayName,
  submitPasswordChange,
  updateMyProfile,
  type MyProfile,
  type PasswordChange,
} from "../../../lib/profile";

const EMPTY_PASSWORDS: PasswordChange = { currentPassword: "", newPassword: "", confirmPassword: "" };

function formatLastLogin(value: string | null) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2" style={{ borderBottom: "1px solid #F5F0EF" }}>
      <span style={{ fontSize: "0.8125rem", color: "#7A6C6A" }}>{label}</span>
      <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1C1C1C", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function FormMessage({ tone, text }: { tone: "error" | "success"; text: string }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className="rounded-md px-3 py-2" style={{ fontSize: "0.8rem", color: tone === "error" ? "#C0392B" : "#2E7D32", background: tone === "error" ? "#FFEBEE" : "#E8F5E9" }}>
      {text}
    </p>
  );
}

interface MyProfilePageProps {
  /** The name shown in the sidebar changed. */
  onNameChange: (fullName: string) => void;
  /** The backend ended every session; return to the login page with this message. */
  onSessionEnded: (message: string) => void;
}

export function MyProfilePage({ onNameChange, onSessionEnded }: MyProfilePageProps) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [passwords, setPasswords] = useState<PasswordChange>(EMPTY_PASSWORDS);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const load = () => {
    setLoadError(false);
    getMyProfile()
      .then((data) => {
        setProfile(data);
        setFullName(data.fullName);
        setPhone(data.phone ?? "");
      })
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const profileChanged = profile !== null && (fullName.trim() !== profile.fullName || phone.trim() !== (profile.phone ?? ""));

  const saveProfile = async () => {
    const name = fullName.trim();
    const number = phone.trim();
    if (name.length < 2) { setProfileError("Your name must be at least 2 characters."); return; }
    if (number && !isValidPhone(number)) { setProfileError("Enter a phone number with 7 to 20 digits, for example +91 98765 43210."); return; }
    setProfileError(null);
    setSavingProfile(true);
    try {
      const updated = await updateMyProfile({ fullName: name, phone: number || null });
      setProfile(updated);
      setFullName(updated.fullName);
      setPhone(updated.phone ?? "");
      updateStoredUser({ fullName: updated.fullName });
      onNameChange(updated.fullName);
      toast.success("Your details were saved.");
    } catch (error) {
      setProfileError(isApiError(error) ? error.message : "Could not save your details. Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(null);
    setChangingPassword(true);
    const result = await submitPasswordChange(passwords);
    setChangingPassword(false);
    if (!result.ok) { setPasswordError(result.message); return; }
    setPasswords(EMPTY_PASSWORDS);
    setPasswordSuccess(result.message);
    // The backend has signed this account out everywhere, this tab included.
    onSessionEnded(result.message);
  };

  const setPassword = (field: keyof PasswordChange) => (value: string) => setPasswords((current) => ({ ...current, [field]: value }));

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="My Profile" subtitle="Your account details and password." />

      {loadError ? (
        <Card>
          <div className="p-5 flex items-center justify-between gap-3">
            <p style={{ fontSize: "0.8125rem", color: "#C0392B" }}>Your profile could not be loaded.</p>
            <Btn variant="secondary" size="sm" onClick={load}>Try again</Btn>
          </div>
        </Card>
      ) : !profile ? (
        <p style={{ fontSize: "0.8125rem", color: "#7A6C6A" }}>Loading your profile...</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Account" />
              <div className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <UserCircle size={40} color="#A52A2A" strokeWidth={1.5} />
                  <div>
                    <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "#1C1C1C" }}>{profile.fullName}</p>
                    <p style={{ fontSize: "0.775rem", color: "#7A6C6A" }}>{roleDisplayName(profile.role.name)}</p>
                  </div>
                </div>
                <DetailRow label="Email" value={profile.email} />
                <DetailRow label="Role" value={roleDisplayName(profile.role.name)} />
                <DetailRow label="Phone" value={profile.phone ?? "Not added"} />
                <DetailRow label="Last login" value={formatLastLogin(profile.lastLogin)} />
                <p className="mt-3" style={{ fontSize: "0.75rem", color: "#9A8A88" }}>To change your email or role, ask an administrator.</p>
              </div>
            </Card>

            <Card>
              <CardHeader title="Edit details" />
              <div className="p-5 flex flex-col gap-3">
                <Input label="Full name" value={fullName} onChange={setFullName} autoComplete="name" />
                <Input label="Phone number" value={phone} onChange={setPhone} placeholder="+91 98765 43210" type="tel" autoComplete="tel" />
                {profileError && <FormMessage tone="error" text={profileError} />}
                <div>
                  <Btn onClick={saveProfile} disabled={!profileChanged || savingProfile}><Save size={14} /> {savingProfile ? "Saving..." : "Save details"}</Btn>
                </div>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Change password" subtitle="You will be asked to log in again afterwards." />
            <div className="p-5 flex flex-col gap-3">
              <Input label="Current password" type="password" value={passwords.currentPassword} onChange={setPassword("currentPassword")} autoComplete="current-password" />
              <Input label="New password" type="password" value={passwords.newPassword} onChange={setPassword("newPassword")} autoComplete="new-password" />
              <ul className="flex flex-col gap-1 pl-1" aria-label="Password rules">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(passwords.newPassword);
                  return (
                    <li key={rule.hint} className="flex items-center gap-2" style={{ fontSize: "0.775rem", color: met ? "#2E7D32" : "#7A6C6A" }}>
                      {met ? <CheckCircle2 size={13} /> : <Circle size={13} />} {rule.hint}
                    </li>
                  );
                })}
              </ul>
              <Input label="Confirm new password" type="password" value={passwords.confirmPassword} onChange={setPassword("confirmPassword")} autoComplete="new-password" />
              {passwords.confirmPassword && passwords.confirmPassword !== passwords.newPassword && (
                <p style={{ fontSize: "0.775rem", color: "#C0392B" }}>The two new passwords do not match yet.</p>
              )}
              {passwordError && <FormMessage tone="error" text={passwordError} />}
              {passwordSuccess && <FormMessage tone="success" text={passwordSuccess} />}
              <div>
                <Btn onClick={changePassword} disabled={changingPassword}><KeyRound size={14} /> {changingPassword ? "Changing..." : "Change password"}</Btn>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
