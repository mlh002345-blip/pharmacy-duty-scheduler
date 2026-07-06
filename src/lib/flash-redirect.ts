import { redirect } from "next/navigation";

// Server action redirects carry the URL in an HTTP header, which cannot
// contain raw non-ASCII characters — Turkish flash messages must be
// percent-encoded before being handed to redirect().
export function redirectWithMessage(
  path: string,
  kind: "success" | "error",
  message: string
): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}
