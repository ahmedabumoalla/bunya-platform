import { orderTimeline } from "@/lib/bunya-order";
import { StatusBadge } from "./StatusBadge";

export function OrderTimeline() {
  return (
    <div className="grid gap-4">
      {orderTimeline.map((event, index) => (
        <article
          key={`${event.title}-${event.time}`}
          className="grid gap-4 rounded-lg border border-[#5a3a1f]/15 bg-[#fffaf1] p-5 md:grid-cols-[auto_1fr_auto] md:items-start"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#214536] text-sm font-black text-white">
            {index + 1}
          </span>
          <div>
            <h3 className="text-xl font-black">{event.title}</h3>
            <p className="mt-2 leading-7 text-[#766b5d]">{event.description}</p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <StatusBadge tone={event.status === "delivered" ? "green" : "sand"}>
              {event.time}
            </StatusBadge>
          </div>
        </article>
      ))}
    </div>
  );
}
