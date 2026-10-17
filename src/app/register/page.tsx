import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create account · Group Chat Rota" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
