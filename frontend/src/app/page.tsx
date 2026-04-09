import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-2">AI Accounting & Auditing Portal</h1>
      <p className="text-gray-500 mb-10 text-center max-w-xl">
        A practical demonstration of AI-powered tools for accounting and auditing workflows.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
        <NavCard href="/chat" title="AI Chat Assistant" description="Ask any accounting or auditing question." />
        <NavCard href="/data-viz" title="Data Visualisation" description="Explore financial data with natural language." />
        <NavCard href="/receipts" title="Receipt Scanner" description="Upload receipts and receive an emailed analysis." />
        <NavCard href="/transactions" title="Transaction Classifier" description="Classify transactions against budget lines." />
      </div>
    </main>
  );
}

function NavCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="block border border-gray-200 rounded-xl p-6 hover:border-blue-500 hover:shadow-md transition-all bg-white"
    >
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      <p className="text-sm text-gray-500">{description}</p>
    </Link>
  );
}
