import Layout from './components/Layout'
import {
  DynamicContextProvider,
} from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';


function App() {
  return (
    <DynamicContextProvider
      settings={{
        environmentId: "848fbc8b-6287-4ef8-ad0e-558dd40a06f6",
        walletConnectors: [EthereumWalletConnectors],
      }}
    >
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
          </Routes>
        </Layout>
      </Router>
    </DynamicContextProvider>
  )
}

export default App
