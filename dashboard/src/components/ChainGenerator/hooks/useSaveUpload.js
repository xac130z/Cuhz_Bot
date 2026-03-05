import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getClientId } from "@/utils/getClientId";

export function useSaveUpload({ setLastSavedUrl }) {
  const saveUploadMutation = useMutation({
    mutationFn: async ({ dataUrl, chainStyle }) => {
      const clientId = getClientId();
      const response = await fetch("/api/chain/save-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, style: chainStyle, clientId }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg =
          errorData.error ||
          `When fetching /api/chain/save-upload, the response was [${response.status}] ${response.statusText}`;
        throw new Error(msg);
      }
      return response.json();
    },
    onSuccess: (data) => {
      setLastSavedUrl(data?.imageUrl || null);
      toast.success("Saved to your gallery");
    },
    onError: (err) => {
      console.error(err);
      toast.error(
        typeof err?.message === "string" ? err.message : "Could not save image",
      );
    },
  });

  return saveUploadMutation;
}
