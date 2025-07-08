// App.tsx

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import Layout from './Layout';
import TokensPage from './pages/tokens';
import TradersPage from './pages/traders';
import { TokensMonitor } from './pages/tokens_monitor';
import { SocketProvider } from './contexts/SocketContext';



function App() {
    return (
        <SocketProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Layout />}>
                        <Route path="tokens" element={<TokensPage />} />
                        <Route path="traders" element={<TradersPage />} />
                        <Route path="monitor" element={<TokensMonitor />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </SocketProvider>
    );
}


export default App;
