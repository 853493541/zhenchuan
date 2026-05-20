import { redirect } from "next/navigation";

export default function SoundBrowserPage() {
  redirect("/ability-editor?tab=soundReview#sound-review-board");
}
