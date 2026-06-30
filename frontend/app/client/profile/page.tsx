"use client";

import { useEffect, useRef, useState } from "react";
import { changePassword, clientUpload, getProfile, updateProfile } from "../../lib/client";
import { API_URL } from "../../lib/api";
import { isStrongPassword } from "../../lib/validation";
import { useToast } from "../../components/toast/ToastProvider";
import { PageHeader, Card, SkeletonText } from "../../admin/ui";
import PasswordChecklist from "../../components/PasswordChecklist";

export default function ClientProfilePage() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [avatar, setAvatar] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    getProfile()
      .then((d) => {
        setIsAdmin(d.profile.is_admin);
        setName(d.profile.name ?? "");
        setEmail(d.profile.email ?? "");
        setPhone(d.profile.phone ?? "");
        setDesignation(d.profile.designation ?? "");
        setAvatar(d.profile.avatar ?? "");
      })
      .catch(() => toast.error("Could not load your profile."))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveProfile() {
    if (!name.trim()) return toast.warning("Please enter your name.");
    setSavingProfile(true);
    try {
      await updateProfile({ name, email, phone: isAdmin ? undefined : phone });
      toast.success("Profile updated.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const res = await clientUpload(file);
      setAvatar(res.url);
      await updateProfile({ avatar: res.url });
      toast.success("Photo updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function savePassword() {
    if (!isStrongPassword(next, email)) return toast.warning("Please choose a stronger password — check the requirements below.");
    if (next !== confirm) return toast.warning("Passwords don't match.");
    setSavingPw(true);
    try {
      await changePassword({ current_password: cur, new_password: next });
      toast.success("Password changed.", { title: "Done" });
      setCur(""); setNext(""); setConfirm("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change password");
    } finally {
      setSavingPw(false);
    }
  }

  if (!loaded) return (<><PageHeader title="My Profile" /><Card><SkeletonText lines={5} /></Card></>);

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/15";
  const labelCls = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <>
      <PageHeader title="My Profile" subtitle="Manage your account details" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Account</h3>
          <div className="mb-5 flex items-center gap-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar.startsWith("http") ? avatar : `${API_URL}${avatar}`} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-xl font-bold text-white">{(name || email || "?").slice(0, 1).toUpperCase()}</span>
            )}
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">{uploading ? "Uploading…" : "Change photo"}</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          </div>
          <div className="space-y-4">
            <div><label className={labelCls}>Name</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></div>
            {!isAdmin && (
              <>
                <div><label className={labelCls}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></div>
                {designation && (
                  <div>
                    <label className={labelCls}>Designation</label>
                    <input value={designation} disabled className={`${inputCls} cursor-not-allowed bg-slate-50 text-slate-500`} />
                    <p className="mt-1 text-xs text-slate-400">Managed by your administrator.</p>
                  </div>
                )}
              </>
            )}
            <button onClick={saveProfile} disabled={savingProfile} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{savingProfile ? "Saving…" : "Save profile"}</button>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Security</h3>
          <div className="space-y-4">
            <div><label className={labelCls}>Current password</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={labelCls}>New password</label>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} />
              {next.length > 0 && <PasswordChecklist password={next} email={email} className="mt-3" />}
            </div>
            <div><label className={labelCls}>Confirm new password</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} /></div>
            <button onClick={savePassword} disabled={savingPw} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">{savingPw ? "Saving…" : "Change password"}</button>
          </div>
        </Card>
      </div>
    </>
  );
}
