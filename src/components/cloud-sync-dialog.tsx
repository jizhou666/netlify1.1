import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { cloudSyncStatus, pushToCloud, type CloudSyncResult } from "@/lib/cloud-sync-fns";

const ROWS: { key: "categories" | "products" | "variants" | "stock_movements"; label: string }[] = [
  { key: "categories", label: "分类" },
  { key: "products", label: "货号" },
  { key: "variants", label: "颜色/型号" },
  { key: "stock_movements", label: "出入库流水" },
];

function formatTime(iso: string | null): string {
  if (!iso) return "从未同步";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

export function CloudSyncDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [result, setResult] = useState<CloudSyncResult | null>(null);

  const status = useQuery({
    queryKey: ["cloud-sync"],
    queryFn: () => cloudSyncStatus(),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) void status.refetch();
    // 只在打开弹窗那一刻刷新一次状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const push = useMutation({
    mutationFn: () => pushToCloud({ data: { confirm: true } }),
    onSuccess: (res) => {
      setResult(res);
      toast.success("已同步到云端");
      void qc.invalidateQueries({ queryKey: ["cloud-sync"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const data = status.data;
  const cloudFirst = data?.mode === "cloud-first";
  const ready = Boolean(data?.configured) && !cloudFirst;
  const cloudCounts = data?.cloud ?? null;
  const localCounts = data?.local ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudUpload className="size-5 text-primary" />
            云端同步（Neon）
          </DialogTitle>
          <DialogDescription>
            台账平时跑在本机库（快、断网也能用）。这里可以把本机整套台账一键上传到云端库，
            换台电脑或云端站点也能拿到同一份数据。
          </DialogDescription>
        </DialogHeader>

        {status.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">正在检查云端状态…</p>
        ) : status.isError ? (
          <div className="rounded border border-border bg-card px-3 py-3 text-sm">
            <p className="text-primary">检查失败：{errorMessage(status.error)}</p>
            <Button className="mt-2" variant="outline" size="sm" onClick={() => void status.refetch()}>
              <RefreshCw className="size-3.5" />
              重试
            </Button>
          </div>
        ) : cloudFirst ? (
          <div className="rounded border border-border bg-muted/40 px-3 py-3 text-sm">
            <p className="font-medium">应用当前直接使用云端库</p>
            <p className="mt-1 text-muted-foreground">
              因为配置了 <code>DATABASE_URL</code>（{data?.host}），所有读写本来就实时落在云端，
              不需要再上传。想改回「本机库 + 手动同步」，把 <code>.env.local</code> 里的
              <code> DATABASE_URL</code> 改名成 <code>SYNC_DATABASE_URL</code> 再重启即可。
            </p>
          </div>
        ) : !data?.configured ? (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium text-warn">还没有配置云端库地址</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                在项目目录 <code>E:\netlify-git</code> 新建文件 <code>.env.local</code>
              </li>
              <li>
                写入一行：
                <code className="mt-1 block overflow-x-auto rounded bg-card px-2 py-1 text-xs">
                  SYNC_DATABASE_URL=postgresql://用户名:密码@ep-xxx-pooler.区域.aws.neon.tech/neondb?sslmode=require
                </code>
              </li>
              <li>重新运行「启动库存系统.bat」，再回来点这里</li>
            </ol>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">云端库</p>
                <p className="mt-0.5 truncate font-medium">{data.host}</p>
              </div>
              <div className="rounded border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground">上次同步</p>
                <p className="mt-0.5 font-medium">{formatTime(data.lastSyncAt)}</p>
              </div>
            </div>

            {data.cloudError ? (
              <div className="rounded border border-border bg-card px-3 py-2 text-sm">
                <p className="text-primary">连不上云端：{data.cloudError}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  检查网络、连接串是否正确；Neon 冷启动偶尔要等几秒，可以点下面的「刷新状态」。
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">内容</th>
                      <th className="px-3 py-1.5 text-right font-medium">本机</th>
                      <th className="px-3 py-1.5 text-right font-medium">云端</th>
                      <th className="px-3 py-1.5 text-right font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => {
                      const local = localCounts?.[row.key];
                      const cloud = cloudCounts?.[row.key];
                      const same = local != null && cloud != null && local === cloud;
                      return (
                        <tr key={row.key} className="border-t border-border/60">
                          <td className="px-3 py-1.5">{row.label}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{local ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {cloudCounts ? cloud : "未建表"}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {cloudCounts ? (
                              <span className={same ? "text-ok" : "text-warn"}>
                                {same ? "一致" : "待同步"}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
              同步是「用本机台账覆盖云端」：云端独有的记录会被清掉。上传前请确认本机数据是最新的。
            </p>

            {result && (
              <div className="rounded border border-border bg-card px-3 py-2 text-sm">
                <p className="font-medium text-ok">✓ 同步完成</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  用时 {(result.durationMs / 1000).toFixed(1)} 秒 · 上传 分类
                  {result.pushed.categories ?? 0} / 货号 {result.pushed.products ?? 0} / 型号{" "}
                  {result.pushed.variants ?? 0} / 流水 {result.pushed.stock_movements ?? 0}
                  <br />
                  云端现有：货号 {result.cloud.products} · 型号 {result.cloud.variants} · 流水{" "}
                  {result.cloud.stock_movements}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => void status.refetch()} disabled={push.isPending}>
                <RefreshCw className="size-4" />
                刷新状态
              </Button>
              <Button onClick={() => push.mutate()} disabled={push.isPending || !ready}>
                <CloudUpload className="size-4" />
                {push.isPending ? "同步中…" : "一键上传本机台账到云端"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
