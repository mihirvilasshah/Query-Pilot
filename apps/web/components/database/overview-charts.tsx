"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Slice {
  name: string;
  value: number;
}

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "var(--shadow-soft)",
};

/** Charts bind to CSS variables, so they follow light/dark automatically. */
export function ObjectDistributionChart({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No objects to chart.</p>;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row" data-testid="object-distribution">
      <div className="h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
              {data.map((_, i) => <Cell key={i} style={{ fill: COLORS[i % COLORS.length] }} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "var(--popover-foreground)" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="flex-1 text-muted-foreground">{d.name}</span>
            <span className="font-medium tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TopTablesChart({ data }: { data: Slice[] }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No tables to chart.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={150} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={tooltipStyle} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} style={{ fill: "var(--chart-1)" }} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
