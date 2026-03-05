import { toast } from "sonner";
/**
 * Starts the Twitch OAuth login flow by fetching the authorize URL
 * from the JSON endpoint and redirecting the browser to Twitch.
 */
export async function startTwitchLogin() {
  try {
    const response = await fetch("/api/auth/twitch?format=json");

    if (!response.ok) {
      throw new Error(
        `Failed to get Twitch login URL: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    if (!data.url) {
      throw new Error("No authorization URL received from server");
    }

    // Redirect to Twitch authorization page
    window.location.href = data.url;
  } catch (error) {
    console.error("Could not start Twitch login:", error);
    toast.error("Could not start Twitch login, please try again.");
  }
}
