import { redirect } from "next/navigation";

// Temporary until the landing page lands: the table now lives at /app.
export default function Home() {
  redirect("/app");
}
