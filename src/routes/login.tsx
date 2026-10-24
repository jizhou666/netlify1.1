import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gateLogin } from "@/lib/inventory-gate";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "登录 · 芳村仓库存" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await gateLogin({ data: { password } });
      if (!result.ok) {
        setError("密码不对，再试一次");
        setBusy(false);
        return;
      }
      await navigate({ to: "/", replace: true });
    } catch {
      setError("提交失败，请刷新页面重试");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Warehouse className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground">库存台账</p>
            <h1 className="font-display text-xl font-semibold tracking-tight">芳村仓库存</h1>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-xl border border-border bg-card p-5 shadow-ledger"
        >
          <label htmlFor="password" className="text-sm font-medium">
            访问密码
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            输入一次后，这台设备 30 天内不用再输。
          </p>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) setError(null);
            }}
            placeholder="请输入访问密码"
            className="mt-3 h-10"
            aria-invalid={error != null}
          />
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || password.length === 0} className="mt-4 w-full">
            {busy ? "验证中…" : "进入台账"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          忘记密码？找管理员在服务器上重置（KC_PASSWORD 环境变量）。
        </p>
      </div>
    </main>
  );
}
