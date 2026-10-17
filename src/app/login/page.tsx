import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in · Group Chat Rota" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
