'use client';
import { motion } from 'framer-motion';
import Image from 'next/image';
import Logo from '../public/logo.svg';
import styles from './page.module.css';
import Button from './button';

export default function Page() {
  // Variants for the "INTELLIGENT" animation
  const intelligentVariants = {
    animate: {
      rotate: [-2, 2, -2], // Side-to-side rotation
      transition: {
        duration: 6, // Slower movement
        repeat: Infinity, // Loop animation
        ease: 'easeInOut',
      },
    },
  };

  // Function to generate random movement variants for plus signs
  const generatePlusVariants = () => ({
    animate: {
      x: [0, Math.random() * 30 - 15, Math.random() * 30 - 15, 0], // Random horizontal movement
      y: [0, Math.random() * 30 - 15, Math.random() * 30 - 15, 0], // Random vertical movement
      rotate: [0, Math.random() * 360 - 180, Math.random() * 360 - 180, 0], // Random rotation
      transition: {
        duration: Math.random() * 6 + 4, // Slow random motion (4–10 seconds)
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
  });
  

  return (
    <main>
      <div className={styles.header}>
        <Image src={Logo} alt="Logo" />
        <h1>HERMES</h1>
      </div>

      <div className={styles.hero}>
        <div className={styles.heroText}>
          <h1>BUILD</h1>
          <motion.h1
            className={styles.intelligent}
            variants={intelligentVariants}
            animate="animate"
          >
            INTELLIGENT
          </motion.h1>
          <h1>CUSTOMER SERVICE CHATBOTS</h1>
        </div>
        <h2>Revolutionize your customer support with our AI helpers.</h2>
        <Button
          text="Get Started"
          link="/new-business"
          arrowWhite={true}
        />
      </div>

      {/* Animated Plus Signs */}
      <div className={styles.plusContainer}>
        {[...Array(5)].map((_, index) => (
          <motion.div
            key={index}
            className={styles.plusSign}
            variants={generatePlusVariants()} // Generate random motion for each
            animate="animate"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="yellow"
              stroke="black" /* Add black border */
              strokeWidth="2"
              width="24"
              height="24"
            >
              <path d="M12 5v6H6v2h6v6h2v-6h6v-2h-6V5h-2z" />
            </svg>
          </motion.div>
        ))}
      </div>

      <div className={styles.devpost}>
        <Image src={Logo} alt="Logo" />

        <div className={styles.devpostText}>
          <h2>01.26.25</h2>
          <h1>SEE PROJECT</h1>
        </div>

        <Button
          link="/dashboard"
          arrowOnly={true}
          arrowWhite={true}
        />
      </div>

      <div className={styles.athul}>
        <div className={styles.yellowCircle}></div>
        <h1>ATHUL SURESH</h1>
        <Button
          link="https://www.athuls.com/"
          arrowOnly={true}
          arrowWhite={false}
          target="_blank"
        />
      </div>
    </main>
  );
}
