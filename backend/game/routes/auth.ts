import jwt from "jsonwebtoken";

export function getUserIdFromCookie(req: any): string {
  const token = req.cookies?.auth_token;
  if (!token) throw new Error("ERR_NOT_AUTHENTICATED");
  const payload: any = jwt.verify(token, process.env.JWT_SECRET!);
  return payload.uid;
}
