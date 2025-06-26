import { motion } from "framer-motion";

export default function JestersPrivilege() {
  return (
    <motion.a
      href="https://jestersprivilege.ca"
      className="text-rose-800 font-bold mb-6"
      initial="rest"
      animate="rest"
      whileHover="hover"
    >
      <motion.div
        className="relative"
        variants={{ hover: { y: -20, scale: 1.1 }, rest: { y: 0 } }}
      >
        Read Jester's Privilege
      </motion.div>
      <motion.svg
        height="244.640"
        width="169.075"
        xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink"
        className="rounded-lg border-2 border-black overflow-hidden bg-white"
        variants={{
          hover: {
            scale: 1.1,
          },
        }}
      >
        <g id="joker_text" transform="translate(1.25,-736.02999)">
          <text
            transform="matrix(0.512616,0,0,1.170664,8.034702,763.1465)"
            style={{
              fontWeight: "bold",
              fontSize: "22px",
              fontFamily: "DejaVu Serif",
            }}
            id="text3225"
          >
            JESTER
          </text>
          <text
            transform="matrix(-0.512616,0,0,-1.170664,158.5403,953.5535)"
            style={{
              fontWeight: "bold",
              fontSize: "22px",
              fontFamily: "DejaVu Serif",
            }}
            id="text3227"
          >
            JESTER
          </text>
        </g>
        <g id="joker_full" transform="translate(1.25,-736.02999)">
          <g transform="matrix(0.203,0,0,0.203,441.265,911.431)">
            <motion.use
              variants={{
                rest: {
                  scale: 1,
                  rotateY: 0,
                  rotateZ: 0,
                  translateX: 0,
                  translateY: 0,
                },
                hover: {
                  scale: 2.5,
                  rotateY: 180,
                  rotateZ: -20,
                  translateX: 200,
                  translateY: 500,
                },
              }}
              initial={false}
              href="svg-cards.svg#joker"
              x="0"
              y="0"
              width="100%"
              height="100%"
            />
          </g>
          <g transform="matrix(0.91,0.415,0.415,-0.91,45.691,911.1)">
            <motion.use
              variants={{
                hover: {
                  translateX: -10,
                  translateY: 150,
                  scale: 1.5,
                },
              }}
              href="svg-cards.svg#heart"
              x="0"
              y="0"
              width="100%"
              height="100%"
            />
          </g>
          <g transform="matrix(0.968,-0.249,-0.249,-0.968,57.447,931.033)">
            <motion.use
              variants={{
                hover: {
                  scale: 1.5,
                  rotate: 10,
                  translateX: -15,
                  translateY: 100,
                },
              }}
              href="svg-cards.svg#diamond"
              x="0"
              y="0"
              width="100%"
              height="100%"
            />
          </g>
          <g transform="matrix(0.875,0.485,0.485,-0.875,80.395,932.899)">
            <motion.use
              variants={{
                hover: {
                  scale: 1.5,
                  translateX: -40,
                  translateY: 180,
                },
              }}
              href="svg-cards.svg#club"
              x="0"
              y="0"
              width="100%"
              height="100%"
            />
          </g>
          <g transform="matrix(0.961,-0.277,-0.277,-0.961,56.06,885.779)">
            <motion.use
              variants={{
                hover: {
                  scale: 1.5,
                  rotate: 10,
                  translateX: 120,
                  translateY: 80,
                },
              }}
              href="svg-cards.svg#spade"
              x="0"
              y="0"
              width="100%"
              height="100%"
            />
          </g>
        </g>
      </motion.svg>
    </motion.a>
  );
}
