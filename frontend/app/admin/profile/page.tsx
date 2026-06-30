"use client";

import { useEffect, useRef, useState } from "react";
import { adminUpload, changePassword, getProfile, updateProfile } from "../../lib/admin";
import { API_URL } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";
import { Card, PageHeader, SkeletonText } from "../ui";

export default function ProfilePage() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    getProfile().then((d) => {
      setName(d.profile.name ?? "");
      setEmail(d.profile.email ?? "");
      setAvatar(d.profile.avatar ?? "");
      setLoaded(true);
    });
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      await updateProfile({ name, email });
      toast.success("Profile updated.", { title: "Saved" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(file: File) {
    try {
      const res = await adminUpload<{ avatar: string }>("/profile/avatar", "avatar", file);
      setAvatar(res.avatar);
      toast.success("Photo updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function savePassword() {
    if (next.length < 8) return toast.warning("New password must be at least 8 characters.");
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

  const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/15";

  return (
    <>
      <PageHeader title="My Profile" subtitle="Manage your account details" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Account</h3>
          <div className="mb-5 flex items-center gap-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${avatar}`} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xl font-bold text-white">{(name || email).slice(0, 1).toUpperCase()}</span>
            )}
            <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Change photo</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          </div>
          <div className="space-y-4">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Name</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></div>
            <button onClick={saveProfile} disabled={savingProfile} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{savingProfile ? "Saving…" : "Save profile"}</button>
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Security</h3>
          <div className="space-y-4">
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Current password</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className={inputCls} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">New password</label><input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} /></div>
            <div><label className="mb-1 block text-sm font-medium text-slate-700">Confirm new password</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} /></div>
            <button onClick={savePassword} disabled={savingPw} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">{savingPw ? "Saving…" : "Change password"}</button>
          </div>
        </Card>
      </div>
    </>
  );
}
