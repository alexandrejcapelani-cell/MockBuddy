import { logOut } from "@/app/actions/auth";
import { currentUser } from "@/lib/auth";

/** The logout button (data-testid="logout"), shown on every page while someone is signed in. */
export async function LogoutButton() {
  const user = await currentUser();
  if (!user) return null;
  return (
    <form action={logOut}>
      <button type="submit" data-testid="logout" className="btn-quiet text-sm whitespace-nowrap">
        Log out
      </button>
    </form>
  );
}
