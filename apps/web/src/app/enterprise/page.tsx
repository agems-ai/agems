'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight, CheckCircle2, Clock, Users, Rocket, Shield,
  Bot, Wrench, MessageSquare, Zap, Github, CreditCard, Wallet,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function Nav() {
  return (
    <nav className="border-b border-[var(--border)] sticky top-0 z-50 bg-[var(--background)]/95 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold">
          <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">AGEMS</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-[var(--muted)] hover:text-white transition-colors">Home</Link>
          <Link href="/login"
            className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-sm font-medium transition-colors">
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#6c5ce7]/10 border border-[#6c5ce7]/30 text-[#6c5ce7] text-xs font-medium mb-6">
        <Rocket size={14} />
        Enterprise Setup
      </div>
      <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-6">
        <span className="text-white">Launch AGEMS for</span>
        <br />
        <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent">
          Your Business
        </span>
      </h1>
      <p className="text-lg text-[var(--muted)] max-w-2xl mx-auto mb-4">
        Get a dedicated setup session with our team. We deploy AGEMS, configure agents for your use case,
        connect your tools, and make sure everything works — so you can start seeing results on day one.
      </p>
      <p className="text-sm text-[var(--muted)]/70 max-w-lg mx-auto">
        Up to 3 hours of hands-on configuration with an AGEMS expert.
      </p>
    </section>
  );
}

function PricingCard() {
  const [loading, setLoading] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const searchParams = useSearchParams();
  const success = searchParams.get('success');

  const handleStripe = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/stripe/checkout`, { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <section className="max-w-lg mx-auto px-6 pb-20">
        <div className="bg-[var(--card)] border-2 border-green-500/40 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Payment Successful!</h2>
          <p className="text-[var(--muted)]">
            Thank you for your purchase. We'll reach out to you within 24 hours to schedule your setup session.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="max-w-lg mx-auto px-6 pb-20">
        <div className="bg-[var(--card)] border-2 border-[var(--accent)]/40 rounded-2xl p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#6c5ce7] to-[#00cec9]" />

          <div className="text-sm text-[var(--accent)] font-medium mb-2">Enterprise Setup</div>
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="text-5xl font-bold text-white">$980</span>
          </div>
          <p className="text-sm text-[var(--muted)] mb-8">One-time payment. Up to 3 hours of expert setup.</p>

          <button
            onClick={() => setShowPayment(true)}
            className="inline-flex items-center justify-center gap-2 w-full px-6 py-4 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-xl font-semibold text-lg transition-colors"
          >
            Get Started <ArrowRight size={20} />
          </button>

          <p className="text-xs text-[var(--muted)]/60 mt-4">
            Stripe & PayPal accepted. Invoice provided.
          </p>
        </div>
      </section>

      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !loading && setShowPayment(false)}>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-white text-center mb-2">Choose payment method</h3>
            <p className="text-sm text-[var(--muted)] text-center mb-6">AGEMS Enterprise Setup — $980</p>

            <div className="space-y-3">
              <button
                onClick={handleStripe}
                disabled={loading}
                className="w-full px-5 py-4 bg-[#635bff] hover:bg-[#5349e0] disabled:opacity-50 rounded-xl font-semibold text-white transition-colors flex items-center justify-center gap-3"
              >
                <CreditCard size={20} />
                {loading ? 'Redirecting...' : 'Pay with Card'}
              </button>

              <a
                href="https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=billing%40agems.ai&item_name=AGEMS+Enterprise+Setup&amount=980.00&currency_code=USD&return=https://agems.ai/enterprise?success=true"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-5 py-4 bg-[#0070ba] hover:bg-[#005ea6] rounded-xl font-semibold text-white transition-colors flex items-center justify-center gap-3"
              >
                <Wallet size={20} />
                Pay with PayPal
              </a>
            </div>

            <button
              onClick={() => setShowPayment(false)}
              className="w-full mt-4 text-sm text-[var(--muted)] hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function WhatYouGet() {
  const items = [
    { icon: Bot, title: 'Agent Configuration', desc: 'We create and configure AI agents tailored to your business — roles, permissions, system prompts, and LLM selection.' },
    { icon: Wrench, title: 'Tool Integration', desc: 'Connect your APIs, databases, CRM, and third-party services as callable tools for your agents.' },
    { icon: Users, title: 'Team Setup', desc: 'Set up your org chart, departments, user accounts, and role-based access control.' },
    { icon: MessageSquare, title: 'Channel Configuration', desc: 'Configure communication channels, Telegram bots, and approval workflows.' },
    { icon: Shield, title: 'Security & Policies', desc: 'Set up approval policies, human-in-the-loop controls, and audit logging for your compliance needs.' },
    { icon: Zap, title: 'Workflow Automation', desc: 'Build N8N automation workflows and connect them to your agents for end-to-end process automation.' },
  ];

  return (
    <section className="max-w-4xl mx-auto px-6 pb-24">
      <h2 className="text-2xl font-bold text-center mb-12">What's included</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-start gap-4 p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center shrink-0">
                <Icon size={20} className="text-[var(--accent)]" />
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-sm text-[var(--muted)] leading-relaxed">{item.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { num: '1', title: 'Purchase', desc: 'Complete the payment and we\'ll reach out within 24 hours to schedule your setup session.' },
    { num: '2', title: 'Discovery Call', desc: 'We learn about your business, use cases, tools, and goals in a 30-minute call.' },
    { num: '3', title: 'Setup Session', desc: 'Our expert deploys and configures AGEMS for your specific needs — agents, tools, workflows.' },
    { num: '4', title: 'Go Live', desc: 'Your AI team is ready. We verify everything works and hand over full documentation.' },
  ];

  return (
    <section className="border-y border-[var(--border)] bg-[var(--card)]/30">
      <div className="max-w-4xl mx-auto px-6 py-24">
        <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((s) => (
            <div key={s.num} className="text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--accent)]/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-lg font-bold text-[var(--accent)]">{s.num}</span>
              </div>
              <h3 className="font-semibold text-sm mb-2 text-white">{s.title}</h3>
              <p className="text-xs text-[var(--muted)] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    { q: 'What happens after I pay?', a: 'We\'ll email you within 24 hours to schedule a discovery call. The setup session happens within a week of purchase.' },
    { q: 'Do I need my own server?', a: 'Yes. AGEMS is self-hosted. We can help you set up on any VPS (DigitalOcean, AWS, Hetzner, etc.) during the session.' },
    { q: 'What if 3 hours isn\'t enough?', a: 'Most setups complete well within 3 hours. If your use case requires more time, we offer additional hours at $350/hr.' },
    { q: 'Do I need LLM API keys?', a: 'Yes — you\'ll need API keys from at least one AI provider (OpenAI, Anthropic, Google, etc.). We help you configure them.' },
    { q: 'Can I get a refund?', a: 'If we haven\'t started the setup session, you can get a full refund. After the session begins, we don\'t offer refunds.' },
    { q: 'Do you offer ongoing support?', a: 'The setup is a one-time service. For ongoing support, contact us about a custom support agreement.' },
  ];

  return (
    <section className="max-w-3xl mx-auto px-6 py-24">
      <h2 className="text-2xl font-bold text-center mb-12">Frequently asked questions</h2>
      <div className="space-y-4">
        {faqs.map((faq) => (
          <div key={faq.q} className="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl">
            <h3 className="font-semibold text-white mb-2">{faq.q}</h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">{faq.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--card)]/30">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-[var(--muted)]">
          <span className="bg-gradient-to-r from-[#6c5ce7] to-[#00cec9] bg-clip-text text-transparent font-semibold">
            AGEMS
          </span>
          {' '}&mdash; Agent Management System
        </div>
        <div className="flex items-center gap-6 text-sm text-[var(--muted)]">
          <a href="https://github.com/agems-ai/agems" target="_blank" rel="noopener noreferrer"
            className="hover:text-white transition-colors">GitHub</a>
          <Link href="/" className="hover:text-white transition-colors">Home</Link>
        </div>
      </div>
    </footer>
  );
}

export default function EnterprisePage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <Hero />
      <Suspense><PricingCard /></Suspense>
      <WhatYouGet />
      <HowItWorks />
      <FAQ />
      <Footer />
    </div>
  );
}
