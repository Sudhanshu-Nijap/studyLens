import { pg, getLocalUser, setLocalUser, type LocalUser } from "@/lib/db";

export type AuthContext = {
  user: LocalUser;
  userId: string;
  email: string;
};

export type AuthResult =
  | { ok: true; destination: string }
  | { ok: false; message: string };

/** Get current user from local Docker session */
export async function getUser(): Promise<AuthContext | null> {
  const user = getLocalUser();
  if (user) {
    return { user, userId: user.id, email: user.email };
  }
  return null;
}

/** Get current user or guest fallback */
export async function requireUser(): Promise<{ userId: string; email: string }> {
  const ctx = await getUser();
  if (ctx) return { userId: ctx.userId, email: ctx.email };
  throw new Error("Authentication required. Please sign in.");
}

/** Sign in by email against Docker PostgreSQL users table */
export async function signIn(input: { email: string; password?: string }): Promise<AuthResult> {
  if (!input.email || !input.email.includes("@")) {
    return { ok: false, message: "Please enter a valid email." };
  }

  try {
    const { data, error } = await pg
      .from("users")
      .select("id, email, display_name")
      .eq("email", input.email.trim().toLowerCase())
      .maybeSingle();

    if (error || !data) {
      // Auto-register for clean local dev experience if user doesn't exist yet
      return await signUp(input);
    }

    setLocalUser({
      id: data.id,
      email: data.email,
      displayName: data.display_name || data.email.split("@")[0],
    });

    return { ok: true, destination: "/" };
  } catch (err) {
    return { ok: false, message: "Could not connect to Docker PostgreSQL." };
  }
}

/** Sign up a new user directly in Docker PostgreSQL */
export async function signUp(input: { email: string; password?: string }): Promise<AuthResult> {
  if (!input.email || !input.email.includes("@")) {
    return { ok: false, message: "Please enter a valid email." };
  }

  try {
    const email = input.email.trim().toLowerCase();
    const displayName = email.split("@")[0];

    const { data, error } = await pg
      .from("users")
      .insert({
        email,
        password_hash: "local_hash",
        display_name: displayName,
      })
      .select("id, email, display_name")
      .single();

    if (error) {
      // Already exists - fetch user
      const { data: existing } = await pg.from("users").select("id, email, display_name").eq("email", email).maybeSingle();
      if (existing) {
        setLocalUser({ id: existing.id, email: existing.email, displayName: existing.display_name });
        return { ok: true, destination: "/" };
      }
      return { ok: false, message: error.message };
    }

    setLocalUser({
      id: data.id,
      email: data.email,
      displayName: data.display_name,
    });

    return { ok: true, destination: "/" };
  } catch (err) {
    return { ok: false, message: "Could not register user in Docker PostgreSQL." };
  }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  return { ok: true, destination: "/auth/sign-in" };
}

export async function updatePassword(password: string): Promise<AuthResult> {
  return { ok: true, destination: "/" };
}

/** Sign out */
export async function signOut(): Promise<AuthResult> {
  setLocalUser(null);
  return { ok: true, destination: "/auth/sign-in" };
}
