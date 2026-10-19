// Rules for a subject's name, shared by the server action and its tests.

export const MAX_SUBJECT_NAME = 80;

export type SubjectName = { ok: true; name: string } | { ok: false; message: string };

/** Trims and collapses whitespace; refuses only an empty or overlong name. */
export function cleanSubjectName(raw: string): SubjectName {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name === "") return { ok: false, message: "Type a subject name, for example Econometrics." };
  if (name.length > MAX_SUBJECT_NAME) return { ok: false, message: `Keep the name to ${MAX_SUBJECT_NAME} characters or fewer.` };
  return { ok: true, name };
}
