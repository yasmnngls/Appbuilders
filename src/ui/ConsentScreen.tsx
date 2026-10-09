import { useId, useState } from "react";
import { confirmConsent } from "../app/controller";

export const CONSENT_SCRIPT =
  "Before we start: this interview uses on-device gaze analysis on my laptop. It notes where your eyes and face are " +
  "pointed, such as looking away or reading, so I can ask better follow-up questions. Nothing is recorded, no video " +
  "or images are saved or sent anywhere, and these are observations, not judgements. Is that okay with you?";

/** Screen 1 (FR-001). Consent is recorded here; no camera or window is opened until Screen 2. */
export function ConsentScreen() {
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const nameId = useId();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) return;
    confirmConsent(name.trim() || "Candidate");
  };

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Gazewise</h1>
        <p className="mt-1 text-lg text-zinc-300">Notice. Follow up. Know when to move on.</p>
        <p className="mt-4 leading-relaxed text-zinc-400">
          Gazewise watches where the Candidate's gaze and face point during the interview, and suggests a follow-up
          question when a pattern is worth exploring. Face tracking and the language model both run on this laptop.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm leading-relaxed text-zinc-300">
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-emerald-400" />
        <p>
          <span className="font-medium text-emerald-300">Private by design.</span> No video, images or audio are
          recorded, stored or sent anywhere. Only time-stamped observations are kept in memory, and only until you close
          the Session or export the report.
        </p>
      </div>

      <label htmlFor={nameId} className="flex flex-col gap-1.5">
        <span className="text-sm text-zinc-400">Candidate name</span>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Juan dela Cruz"
          autoComplete="off"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 outline-none focus:border-emerald-500"
        />
      </label>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm font-medium text-zinc-300">Read this to the Candidate</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">“{CONSENT_SCRIPT}”</p>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="size-4 accent-emerald-500"
          />
          The Candidate has been informed and agreed
        </label>
      </div>

      <button
        type="submit"
        disabled={!consent}
        className="press rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue
      </button>
    </form>
  );
}
