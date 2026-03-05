import sql from "@/app/api/utils/sql";

// DELETE /api/chain/generations/:id
// Deletes a generation owned by the current user.
export async function DELETE(request, { params }) {
  try {
    const idRaw = params?.id;
    const generationId = parseInt(String(idRaw || ""), 10);
    if (!Number.isFinite(generationId)) {
      return Response.json({ error: "Invalid id" }, { status: 400 });
    }

    // Auth via twitch cookie
    const cookieHeader = request.headers.get("cookie") || "";
    const match = cookieHeader.match(/twitch_user_id=([^;]+)/);
    if (!match) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = match[1];

    const users = await sql`
      SELECT id, twitch_id, role
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    const user = users[0];
    if (!user || !user.twitch_id) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    // Admins can delete any row, users can delete only their own.
    let rows;
    if (user.role === "admin") {
      rows = await sql`
        DELETE FROM chain_generations
        WHERE id = ${generationId}
        RETURNING id
      `;
    } else {
      rows = await sql`
        DELETE FROM chain_generations
        WHERE id = ${generationId}
          AND user_twitch_id = ${user.twitch_id}
        RETURNING id
      `;
    }

    if (!rows.length) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error("DELETE /api/chain/generations/[id] error", err);
    return Response.json(
      { error: err?.message || "Failed to delete generation" },
      { status: 500 },
    );
  }
}
