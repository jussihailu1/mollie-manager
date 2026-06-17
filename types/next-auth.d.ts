import type { DefaultSession } from "next-auth";
import type { AppUserRole } from "@/lib/auth/permissions";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: AppUserRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppUserRole;
  }
}
