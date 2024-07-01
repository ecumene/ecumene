import { motion } from "framer-motion";

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
          <svg
            className="lg:w-48 lg:h-60 w-28 h-32"
            viewBox="0 0 169.075 244.640"
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
          >
            <use href={`svg-cards.svg#${card}`}></use>
          </svg>
        </motion.div>
      ))}
    </div>
  );
}
