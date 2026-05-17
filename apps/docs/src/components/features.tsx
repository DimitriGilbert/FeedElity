import {
  MonitorPlay,
  ShieldCheck,
  Globe,
  Columns3,
  Cpu,
} from "lucide-react";

const features = [
  {
    icon: MonitorPlay,
    title: "Video-oriented RSS",
    description:
      "Built from the ground up for video content. Aggregate channels from YouTube, Odysee, and PeerTube in a single unified feed.",
    span: "col-span-1 md:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "Self-hosted and private",
    description:
      "Your data stays on your server. No tracking, no telemetry, no third-party analytics. You are the only audience.",
    span: "col-span-1",
  },
  {
    icon: Globe,
    title: "Global catalog",
    description:
      "Browse creators and content without an account. The public catalog lets anyone explore before committing.",
    span: "col-span-1",
  },
  {
    icon: Columns3,
    title: "Three-column workflow",
    description:
      "A high-density creator, content list, and viewer layout designed for power users who scan fast.",
    span: "col-span-1",
  },
  {
    icon: Cpu,
    title: "Modern open-source stack",
    description:
      "Solid, Hono, Drizzle, SQLite, Docker. Every layer is auditable, replaceable, and built on proven foundations.",
    span: "col-span-1 md:col-span-2",
  },
] as const;

function Features() {
  return (
    <section
      id="features"
      className="relative border-b border-neutral-800/50 bg-neutral-950"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4">
          <div className="h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[120px]" />
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-32 md:py-48">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-bold tracking-tight text-neutral-50 sm:text-5xl">
            Everything you need to own your feed
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-neutral-400">
            No algorithms deciding what you see. No engagement metrics. Just
            the creators you choose, the content they publish, and the tools to
            manage it all.
          </p>
        </div>

        <div className="mt-20 grid grid-cols-1 gap-px bg-neutral-800/50 md:grid-cols-3 md:grid-flow-dense">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`group relative overflow-hidden bg-neutral-950 p-8 transition-colors duration-500 hover:bg-neutral-900/50 ${feature.span}`}
            >
              <div className="relative z-10">
                <div className="flex size-11 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900">
                  <feature.icon className="size-5 text-neutral-300" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-neutral-50">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                  {feature.description}
                </p>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export { Features };
