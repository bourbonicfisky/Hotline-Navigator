import { version as buildVersion } from '../../../src-tauri/tauri.conf.json';
import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import AboutStarfield from './AboutStarfield';

export default function AboutSettingsTab() {
  const [version, setVersion] = useState<string>(buildVersion);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {
      setVersion(buildVersion);
    });
  }, []);

  return (
    <div className="relative h-full overflow-hidden bg-black">
      <AboutStarfield />
      <div className="absolute inset-0 overflow-auto z-10">
        <div className="p-6 space-y-6">
          {/* Hero graphic */}
          <div className="flex justify-center">
            <img
              src="/hotline-hero.webp"
              alt="Hotline Navigator"
              className="w-48 h-auto drop-shadow-[0_0_30px_rgba(200,60,40,0.3)]"
            />
          </div>

          {/* App Name */}
          <div className="text-center">
            <h3 className="text-2xl font-bold text-white">
              Hotline Navigator
            </h3>
            <p className="text-sm text-gray-300 mt-1">
              Version {version}
            </p>
          </div>

          {/* Description */}
          <div className="text-center text-gray-300 text-sm">
            <p>
              A multi-platform port of Hotline, using Tauri, designed for a single pane interface.{' '}
              <a
                href="https://hotline.greggant.com/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); openUrl('https://hotline.greggant.com/'); }}
                className="text-blue-300 hover:text-blue-200 hover:underline cursor-pointer"
              >
                Hotline Navigator Website
              </a>
            </p>
          </div>

          {/* Credits */}
          <div className="border-t border-white/10 pt-4">
            <h4 className="text-sm font-semibold text-white mb-2">
              Credits
            </h4>
            <div className="text-xs text-gray-300 space-y-2">
              <p>
                <strong className="text-white">Author:</strong>{' '}
                <a
                  href="https://greggant.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => { e.preventDefault(); openUrl('https://greggant.com'); }}
                  className="text-blue-300 hover:text-blue-200 hover:underline cursor-pointer"
                >
                  Greg Gant
                </a>
              </p>
              <p>
                Built with <span className="font-mono text-white">Tauri</span>, <span className="font-mono text-white">React</span>, and <span className="font-mono text-white">TypeScript</span>
              </p>
              <p>
                Protocol implementation based on the Hotline protocol specification
              </p>
              <div className="pt-2 space-y-1 min-[700px]:space-y-0 min-[700px]:flex min-[700px]:items-center min-[700px]:justify-between">
                <p className="min-[700px]:text-left">
                  <a
                    href="https://github.com/fuzzywalrus/hotline"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => { e.preventDefault(); openUrl('https://github.com/fuzzywalrus/hotline'); }}
                    className="text-blue-300 hover:text-blue-200 hover:underline cursor-pointer"
                  >
                    GitHub: fuzzywalrus/hotline
                  </a>
                </p>
                <p className="text-gray-400 min-[700px]:text-right">
                  Forked from{' '}
                  <a
                    href="https://github.com/mierau/hotline"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => { e.preventDefault(); openUrl('https://github.com/mierau/hotline'); }}
                    className="text-blue-300 hover:text-blue-200 hover:underline cursor-pointer"
                  >
                    mierau/hotline
                  </a>
                </p>
              </div>
            </div>
          </div>

          {/* Copyright */}
          <div className="text-center text-xs text-gray-400 pt-2 border-t border-white/10">
            <p>&copy; 2026 Greg Gant</p>
          </div>
        </div>
      </div>
    </div>
  );
}
