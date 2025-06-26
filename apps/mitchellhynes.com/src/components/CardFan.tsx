import { motion } from "framer-motion";
import Card from "@ecumene/ui/src/ui/Card";

const cards = [
  "heart_5",
  "club_10",
  "diamond_jack",
  "heart_1",
  "diamond_2",
  "club_3",
  "heart_4",
  "club_5",
  "heart_6",
  "club_king",
];

export default function CardFan({ className }: { className?: string }) {
  return (
    <div
      className={`relative lg:w-48 lg:h-60 w-28 h-32 flex w-full mx-auto justify-center ${className}`}
    >
      {cards.map((card, index) => (
        <motion.div
          key={card}
          className="absolute"
          initial={{ opacity: 0, scale: 1.1, rotate: 0 }}
          animate={{
            opacity: 1,
            scale: 1,
            rotate: -(cards.length - index - 1) * 10,
          }}
          transition={{ duration: 0.1, delay: (cards.length - index) * 0.1 }}
        >
          <Card cardName={card} />
        </motion.div>
      ))}
    </div>
  );
}
