import { useId, useState, type FormEvent } from "react";
import { supabase, friendly } from "../lib/supabase";
import { local } from "../lib/store";
import type { ExternalPlace } from "../lib/types";
import { useT } from "../lib/i18n";
import { Button, Field } from "../ui/kit";

const normCode = (c: string) => c.toUpperCase().replace(/\s+/g, "");

/** Join a property with a code. Resident codes ask for a unit; co-manager codes (start with M-) don't. */
export function JoinForm({ onDone, submitLabel, initialCode }: { onDone: (r: { role: string; name: string }) => void; submitLabel?: string; initialCode?: string }) {
  const { t } = useT();
  const [code, setCode] = useState(initialCode ?? local.get<string>("fc_join", ""));
  const [unit, setUnit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cId = useId(), uId = useId();
  const isMgr = normCode(code).startsWith("M-");
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (normCode(code).length < 8) return setErr(t("Enter the full code, like 7KQ2-HXPM."));
    if (!isMgr && !unit.trim()) return setErr(t("Add your unit so maintenance knows where to go."));
    setBusy(true);
    const { data, error } = await supabase.rpc("join_property", { p_code: normCode(code), p_unit: isMgr ? null : unit.trim() });
    setBusy(false);
    if (error) return setErr(friendly(error));
    local.del("fc_join");
    onDone(data as { role: string; name: string });
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label={t("Property code")} hint={t("Your property manager gives you this code.")} htmlFor={cId}>
        <input id={cId} className="input code-input" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      {!isMgr && (
        <Field label={t("Your unit")} htmlFor={uId}>
          <input id={uId} className="input" placeholder={t("Apt 214 or Bldg 3, #214")} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </Field>
      )}
      {err && <p className="err" role="alert">{err}</p>}
      <Button type="submit" block loading={busy}>{isMgr ? t("Join as co-manager") : submitLabel || t("Join property")}</Button>
    </form>
  );
}

/** A place whose landlord isn't on CanItWait: requests go out by the renter's own email or text app. */
export function ExternalPlaceForm({ initial, onDone, onDelete }: { initial?: ExternalPlace; onDone: () => void; onDelete?: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({
    label: initial?.label ?? "", unit: initial?.unit ?? "", contact_name: initial?.contact_name ?? "",
    contact_email: initial?.contact_email ?? "", contact_phone: initial?.contact_phone ?? "", after_hours_phone: initial?.after_hours_phone ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { l: useId(), u: useId(), n: useId(), e: useId(), p: useId(), a: useId() };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!f.label.trim()) return setErr(t("Give this place a name, like “My apartment”."));
    if (!f.contact_email.trim() && !f.contact_phone.trim()) return setErr(t("Add your landlord's email or phone so CanItWait knows where to send requests."));
    if (f.contact_email && !/^\S+@\S+\.\S+$/.test(f.contact_email.trim())) return setErr(t("That email doesn't look right."));
    setBusy(true);
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
    const q = initial ? supabase.from("external_places").update(row).eq("id", initial.id) : supabase.from("external_places").insert(row);
    const { error } = await q;
    setBusy(false);
    if (error) return setErr(friendly(error));
    onDone();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label={t("Name for this place")} htmlFor={ids.l}><input id={ids.l} className="input" placeholder={t("My apartment")} value={f.label} onChange={set("label")} /></Field>
      <Field label={t("Unit")} optional htmlFor={ids.u}><input id={ids.u} className="input" placeholder={t("Apt 3B")} value={f.unit} onChange={set("unit")} /></Field>
      <Field label={t("Landlord or manager name")} optional htmlFor={ids.n}><input id={ids.n} className="input" value={f.contact_name} onChange={set("contact_name")} /></Field>
      <Field label={t("Their email")} htmlFor={ids.e}><input id={ids.e} className="input" type="email" inputMode="email" placeholder="maintenance@example.com" value={f.contact_email} onChange={set("contact_email")} /></Field>
      <Field label={t("Their phone for texts")} optional htmlFor={ids.p}><input id={ids.p} className="input" type="tel" inputMode="tel" value={f.contact_phone} onChange={set("contact_phone")} /></Field>
      <Field label={t("After-hours emergency line")} optional hint={t("Shown when a report is an emergency.")} htmlFor={ids.a}><input id={ids.a} className="input" type="tel" inputMode="tel" value={f.after_hours_phone} onChange={set("after_hours_phone")} /></Field>
      {err && <p className="err" role="alert">{err}</p>}
      <Button type="submit" block loading={busy}>{initial ? t("Save changes") : t("Add place")}</Button>
      {onDelete && <Button type="button" variant="danger-outline" block onClick={onDelete}>{t("Remove this place")}</Button>}
    </form>
  );
}

export function CreatePropertyForm({ onDone }: { onDone: (id: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [line, setLine] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ids = { n: useId(), a: useId(), l: useId() };
  return (
    <form className="stack" noValidate onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      if (!name.trim()) return setErr(t("Add the property name."));
      setBusy(true);
      const { data, error } = await supabase.rpc("create_property", { p_name: name.trim(), p_address: address.trim() || null, p_after_hours: line.trim() || null });
      setBusy(false);
      if (error) return setErr(friendly(error));
      onDone(data as string);
    }}>
      <Field label={t("Property name")} htmlFor={ids.n}><input id={ids.n} className="input" placeholder="Peachtree Commons" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Address")} optional htmlFor={ids.a}><input id={ids.a} className="input" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <Field label={t("After-hours emergency line")} optional hint={t("Residents see this when a report is an emergency.")} htmlFor={ids.l}><input id={ids.l} className="input" type="tel" inputMode="tel" placeholder="(404) 555-0100" value={line} onChange={(e) => setLine(e.target.value)} /></Field>
      {err && <p className="err" role="alert">{err}</p>}
      <Button type="submit" block loading={busy}>{t("Create property")}</Button>
    </form>
  );
}
