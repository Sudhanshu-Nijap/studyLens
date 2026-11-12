import { useState, useEffect } from "react";
import { getLocalUser, type LocalUser } from "@/lib/db";

/** React hook for local user session state */
export function useAuth() {
  const [user, setUser] = useState<LocalUser | null>(() => getLocalUser());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleStorage = () => {
      setUser(getLocalUser());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    session: user ? { user } : null,
    user,
    loading,
    isAuthenticated: Boolean(user),
  };
}
