import Header from "../components/Header.jsx";
import Hero from "../components/Hero.jsx";
import Caps from "../components/Caps.jsx";
import Footer from "../components/Footer.jsx";
import { Studio } from "@screenxshot/editor";
import { useReveal } from "@screenxshot/editor/hooks/useReveal";
import { useParallax } from "@screenxshot/editor/hooks/useParallax";

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
