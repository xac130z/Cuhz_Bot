import { s as sql } from "./sql-BK77oGq6.js";
import "@neondatabase/serverless";
async function POST(request) {
  try {
    const cookies = request.headers.get("cookie") || "";
    const userIdMatch = cookies.match(/twitch_user_id=([^;]+)/);
    if (!userIdMatch) {
      return Response.json({
        error: "You must be logged in"
      }, {
        status: 401
      });
    }
    const userId = userIdMatch[1];
    const users = await sql`
      SELECT id, twitch_id, username, display_name, role
      FROM users 
      WHERE id = ${userId} 
      LIMIT 1
    `;
    if (users.length === 0) {
      return Response.json({
        error: "User not found"
      }, {
        status: 404
      });
    }
    const user = users[0];
    if (user.role === "admin") {
      return Response.json({
        error: "You are already an admin"
      }, {
        status: 400
      });
    }
    const updatedUsers = await sql`
      UPDATE users 
      SET role = 'admin'
      WHERE id = ${userId}
      RETURNING id, twitch_id, username, display_name, role
    `;
    const updatedUser = updatedUsers[0];
    return Response.json({
      success: true,
      message: "Successfully promoted to admin",
      user: {
        id: updatedUser.id,
        twitch_id: updatedUser.twitch_id,
        username: updatedUser.username,
        display_name: updatedUser.display_name,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error("Error promoting to admin:", error);
    return Response.json({
      error: "Internal server error"
    }, {
      status: 500
    });
  }
}
export {
  POST
};
