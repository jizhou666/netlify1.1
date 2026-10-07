import { createFileRoute } from "@tanstack/react-router";
import { InventoryApp } from "@/components/inventory-app";
import { todayISO } from "@/lib/inventory";
import { listCategories, listInventory } from "@/lib/inventory-fns";

export const Route = createFileRoute("/")({
  loader: async () => {
    const date = todayISO();
    const [inventory, categories] = await Promise.all([
      listInventory({ data: { date, q: "" } }),
      listCategories(),
    ]);
    return { date, inventory, categories };
  },
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  return <InventoryApp initial={initial} />;
}
