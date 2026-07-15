import Header from "../components/Header.jsx";
import Hero from "../components/Hero.jsx";
import Studio from "../components/Studio.jsx";
import Caps from "../components/Caps.jsx";
import Footer from "../components/Footer.jsx";
import { useReveal } from "../hooks/useReveal.js";
import { useParallax } from "../hooks/useParallax.js";

export default function HomePage() {
  useReveal();
  useParallax();
  return (
    <>
      <Header />
      <Hero />
      <Studio />
      <Caps />
      <Footer />
    </>
  );
}
