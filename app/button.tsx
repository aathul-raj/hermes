"use client";
import { motion } from "framer-motion";
import styles from "./Button.module.css";
import { useEffect, useState } from "react";

interface ButtonProps {
  text?: string; // Optional for arrowOnly
  arrowWhite?: boolean;
  arrowOnly?: boolean;
  link: string;
  target?: string;
}

export default function Button({
  text = "",
  arrowWhite = false,
  arrowOnly = false,
  link,
  target = "_self",
}: ButtonProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const arrowSize = isMobile ? 18 : 24;

  return (
    <motion.a
      href={link}
      className={styles.link}
      target={target}
      rel="noopener noreferrer"
    >
      <motion.button
        className={styles.button}
        initial="rest"
        animate="rest"
        whileHover="hover"
        variants={{
          rest: {},
          hover: {},
        }}
      >
        {!arrowOnly && (
          <div className={styles.labelContainer}>
            <span
              className={`${styles.label} ${
                arrowWhite ? styles.textWhite : styles.textBlack
              }`}
            >
              {text}
            </span>
            <motion.div
              className={styles.underlinePrimary}
              style={{
                background: arrowWhite ? "black" : "white",
              }}
              variants={{
                rest: { x: "0%", transition: { duration: 0 } },
                hover: { x: "100%", transition: { duration: 0.4, ease: "easeInOut" } },
              }}
            />
            <motion.div
              className={styles.underlineSecondary}
              style={{
                background: arrowWhite ? "black" : "white",
              }}
              variants={{
                rest: { x: "-100%", transition: { duration: 0 } },
                hover: { x: "0%", transition: { delay: 0.1, duration: 0.4, ease: "easeInOut" } },
              }}
            />
          </div>
        )}
        <div className={styles.arrowContainer}>
          <div
            className={`${styles.circle} ${
              arrowWhite ? styles.circleBlackBg : styles.circleWhiteBg
            }`}
          />
          <motion.svg
            className={`${styles.arrowPrimary} ${
              arrowWhite ? styles.arrowWhite : styles.arrowBlack
            }`}
            width={arrowSize}
            height={arrowSize}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            variants={{
              rest: { x: 0 },
              hover: { x: 35, transition: { duration: 0.4, ease: "easeInOut" } },
            }}
          >
            <path
              d="M5 4L10 8L5 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
          <motion.svg
            className={`${styles.arrowSecondary} ${
              arrowWhite ? styles.arrowWhite : styles.arrowBlack
            }`}
            width={arrowSize}
            height={arrowSize}
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            variants={{
              rest: { x: -35 },
              hover: { x: 0, transition: { duration: 0.4, ease: "easeInOut" } },
            }}
          >
            <path
              d="M5 4L10 8L5 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </div>
      </motion.button>
    </motion.a>
  );
}
