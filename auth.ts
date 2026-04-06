import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import { env, getSetupStatus } from "@/lib/env";

const setupStatus = getSetupStatus();
const authIsReady = setupStatus.auth.ready;
const allowedEmail = env.AUTH_ALLOWED_EMAIL?.toLowerCase();
const authSecret =
  env.AUTH_SECRET ?? "setup-required-auth-secret-change-me-00000000";

const authConfig = {
  debug: env.NODE_ENV === "development",
  pages: {
    error: "/login",
    signIn: "/login",
  },
  providers: authIsReady
    ? [
        Google({
          clientId: env.AUTH_GOOGLE_ID!,
          clientSecret: env.AUTH_GOOGLE_SECRET!,
        }),
      ]
    : [],
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
  trustHost: true,
  callbacks: {
    async signIn({ user }) {
      if (!allowedEmail) {
        return false;
      }

      return user.email?.toLowerCase() === allowedEmail;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email.toLowerCase();
      }

      if (user?.name) {
        token.name = user.name;
      }

      if (token.sub) {
        token.role = "owner";
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email;
        session.user.id = token.sub ?? "owner";
        session.user.role = "owner";
      }

      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
