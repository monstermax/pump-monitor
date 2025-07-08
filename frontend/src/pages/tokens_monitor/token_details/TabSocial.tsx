// TabSocial.tsx

import { TokenDetailData } from "../../../types/server.types";



export const TabSocial: React.FC<{ tokenDetails: TokenDetailData }> = ({ tokenDetails }) => {
    return (
        <div className="token-social">
            <div className="social-links">
                {tokenDetails.website && (
                    <div className="social-item">
                        <span className="social-label">Website:</span>
                        <a href={tokenDetails.website} target="_blank" rel="noopener noreferrer">{tokenDetails.website}</a>
                    </div>
                )}
                {tokenDetails.twitter && (
                    <div className="social-item">
                        <span className="social-label">Twitter:</span>
                        <a href={tokenDetails.twitter} target="_blank" rel="noopener noreferrer">{tokenDetails.twitter}</a>
                    </div>
                )}
                {tokenDetails.telegram && (
                    <div className="social-item">
                        <span className="social-label">Telegram:</span>
                        <a href={tokenDetails.telegram} target="_blank" rel="noopener noreferrer">{tokenDetails.telegram}</a>
                    </div>
                )}
                {!tokenDetails.website && !tokenDetails.twitter && !tokenDetails.telegram && (
                    <div className="no-social">No social media information available</div>
                )}
            </div>
        </div>
    );
};


