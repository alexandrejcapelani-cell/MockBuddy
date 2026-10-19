import { FREE_MOCKS_USED_MESSAGE } from "@/lib/free-mocks";

/** Not an error: the account has used its free mocks, and everything else still works. */
export function FreeMocksUsed({ message }: { message?: string | null }) {
  return (
    <div role="status" className="space-y-2 text-center">
      <p className="neon text-2xl font-bold">No free mocks left</p>
      <p className="mx-auto max-w-prose text-cream">{message ?? FREE_MOCKS_USED_MESSAGE}</p>
    </div>
  );
}
