import Image from 'next/image';
import Logo from '../public/logo.svg';
import styles from './page.module.css';
import Button from './button';

export default function Page() {
  return (
    <main>
      <div className={styles.header}>
        <Image src={Logo} alt="Logo" />
        <h1>HERMES</h1>
      </div>

      <div className={styles.hero}>
        <div className={styles.heroText}>
          <h1>BUILD</h1>
          <h1 className={styles.intelligent}>INTELLIGENT</h1>
          <h1>CUSTOMER SERVICE CHATBOTS</h1>
        </div>
        <h2>Revolutionize your customer support with our AI helpers.</h2>
        <Button
  text="Get Started"
  link="/new-business"
  arrowWhite={true}
/>
      </div>

      <div className={styles.devpost}>
        <Image src={Logo} alt="Logo" />

        <div className={styles.devpostText}>
          <h2>01.26.25</h2>
          <h1>SEE PROJECT</h1>
        </div>

        <Button
  link="https://example.com"
  arrowOnly={true}
  arrowWhite={true}
  target='_blank'
/>
      </div>

      <div className={styles.athul}>
        <div className={styles.yellowCircle}></div>
        <h1>ATHUL SURESH</h1>
        <Button
  link="https://www.athuls.com/"
  arrowOnly={true}
  arrowWhite={false}
  target='_blank'
/>
      </div>
    </main>
  );
}
