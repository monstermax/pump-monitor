// Layout.tsx

import React from 'react';
import { Outlet, Link } from 'react-router-dom';


const Layout: React.FC = () => {
    return (
        <div className="container-fluid">
            <div className="row">
                {/* Sidebar */}
                <nav className="col-md-1 d-none d-md-block bg-light sidebar">
                    <div className="pt-3">
                        <ul className="nav flex-column">
                            <li className="nav-item">
                                <Link to="/monitor" className="nav-link">
                                    Live Monitor
                                </Link>
                            </li>
                            <li className="nav-item">
                                <Link to="/tokens" className="nav-link">
                                    Tokens
                                </Link>
                            </li>
                            <li className="nav-item">
                                <Link to="/traders" className="nav-link">
                                    Traders
                                </Link>
                            </li>
                        </ul>
                    </div>
                </nav>

                {/* Zone principale */}
                <main className="col-md-11 ms-sm-auto px-4">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};


export default Layout;
