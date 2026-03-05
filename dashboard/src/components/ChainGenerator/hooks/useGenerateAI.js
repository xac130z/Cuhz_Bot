import { useMutation } from "@tanstack/react-query";

export function useGenerateAI({ clientId, refetchUsage }) {
  const generateAIMutation = useMutation({
    mutationFn: async ({ prompt, chainStyle }) => {
      const response = await fetch("/api/chain/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          style: chainStyle,
          clientId,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const msg =
          errorData.error ||
          `When fetching /api/chain/generate-ai, the response was [${response.status}] ${response.statusText}`;
        throw new Error(msg);
      }
      return response.json();
    },
    onSuccess: () => {
      refetchUsage();
    },
  });

  return generateAIMutation;
}
