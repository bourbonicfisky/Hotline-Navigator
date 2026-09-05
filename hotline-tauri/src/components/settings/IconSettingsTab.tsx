import { useState, useEffect, useRef } from 'react';
import { usePreferencesStore } from '../../stores/preferencesStore';
import UserIcon from '../users/UserIcon';

// Classic icon set — all icons available on hlwiki.com/index.php/Icon_Gallery
const CLASSIC_ICON_SET = [
  // Featured / common picks
  141, 149, 150, 151, 172, 184, 204,
  2013, 2036, 2037, 2055, 2400, 2505, 2534,
  2578, 2592, 4004, 4015, 4022, 4104, 4131,
  4134, 4136, 4169, 4183, 4197, 4240, 4247,
  // Standard 128–220
  128, 129, 130, 131, 132, 133, 134,
  135, 136, 137, 138, 139, 140, 142,
  143, 144, 145, 146, 147, 148, 152,
  153, 154, 155, 156, 157, 158, 159,
  160, 161, 162, 163, 164, 165, 166,
  167, 168, 169, 170, 171, 173, 174,
  175, 176, 177, 178, 179, 180, 181,
  182, 183, 185, 186, 187, 188, 189,
  190, 191, 192, 193, 194, 195, 196,
  197, 198, 199, 200, 201, 202, 203,
  205, 206, 207, 208, 209, 210, 211,
  212, 213, 214, 215, 216, 217, 218,
  219, 220,
  // Specialized / protocol icons
  233, 234, 235, 236, 237, 238, 239,
  242, 243, 244, 250, 251, 252, 253,
  257, 258, 259, 260, 261, 265, 271,
  277, 301, 321,
  400, 401, 402, 403, 404, 405, 406,
  407, 408, 409, 410, 411, 412, 413,
  414, 415, 416, 417, 418, 419, 420,
  421, 422, 423, 424, 425, 426, 427,
  428, 429, 430, 431, 432, 433, 434,
  500,
  // Misc / legacy
  666, 1250, 1251, 1968, 1969,
  // Modern 2000-range
  2000, 2001, 2002, 2003, 2004,
  2006, 2007, 2008, 2009, 2010, 2011, 2012,
  2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025, 2026, 2027,
  2028, 2029, 2030, 2031, 2032, 2033, 2034,
  2035, 2038, 2040, 2041, 2042, 2043, 2044,
  2045, 2046, 2047, 2048, 2049, 2050, 2051,
  2052, 2053, 2054, 2056, 2057, 2058, 2059,
  2060, 2061, 2062, 2063, 2064, 2065, 2066,
  2067, 2070, 2071, 2072, 2073, 2075, 2079,
  2098, 2100, 2101, 2102, 2103, 2104, 2105,
  2106, 2107, 2108, 2109, 2110, 2112, 2113,
  2115, 2116, 2117, 2118, 2119, 2120, 2121,
  2122, 2123, 2124, 2125, 2126, 2223,
  2401, 2402, 2403, 2404,
  2500, 2501, 2502, 2503, 2504, 2506, 2507,
  2528, 2529, 2530, 2531, 2532, 2533, 2535,
  2536, 2537, 2538, 2539, 2540, 2541, 2542,
  2543, 2544, 2545, 2546, 2547, 2548, 2549,
  2550, 2551, 2552, 2553, 2554, 2555, 2556,
  2557, 2558, 2559, 2560, 2561, 2562, 2563,
  2564, 2565, 2566, 2567, 2568, 2569, 2570,
  2571, 2572, 2573, 2574, 2575, 2576, 2577,
  2579, 2580, 2581, 2582, 2583, 2584, 2585,
  2586, 2587, 2588, 2589, 2590, 2591, 2593,
  2594, 2595, 2596, 2597, 2598, 2599, 2600,
  2818,
  // 3000-range
  3394, 3395,
  // 4000-range
  4000, 4001, 4002, 4003, 4005, 4006, 4007,
  4008, 4009, 4010, 4011, 4012, 4013, 4014,
  4016, 4017, 4018, 4019, 4020, 4021, 4023,
  4024, 4025, 4026, 4027, 4028, 4029, 4030,
  4031, 4032, 4033, 4034, 4035, 4036, 4037,
  4038, 4039, 4040, 4041, 4042, 4043, 4044,
  4045, 4046, 4047, 4048, 4049, 4050, 4051,
  4052, 4053, 4054, 4055, 4056, 4057, 4058,
  4059, 4060, 4061, 4062, 4063, 4064, 4065,
  4066, 4067, 4068, 4069, 4070, 4071, 4072,
  4073, 4074, 4075, 4076, 4077, 4078, 4079,
  4080, 4081, 4082, 4083, 4084, 4085, 4086,
  4087, 4088, 4089, 4090, 4091, 4092, 4093,
  4094, 4095, 4096, 4097, 4098, 4099, 4100,
  4101, 4102, 4103, 4105, 4106, 4107, 4108,
  4109, 4110, 4111, 4112, 4113, 4114, 4115,
  4116, 4117, 4118, 4119, 4120, 4121, 4122,
  4123, 4124, 4125, 4126, 4127, 4128, 4129,
  4130, 4132, 4133, 4135, 4137, 4138, 4139,
  4140, 4141, 4142, 4143, 4144, 4145, 4146,
  4147, 4148, 4149, 4150, 4151, 4152, 4153,
  4154, 4155, 4156, 4157, 4158, 4159, 4160,
  4161, 4162, 4163, 4164, 4165, 4166, 4167,
  4168, 4170, 4171, 4172, 4173, 4174, 4175,
  4176, 4177, 4178, 4179, 4180, 4181, 4182,
  4184, 4185, 4186, 4187, 4188, 4189, 4190,
  4191, 4192, 4193, 4194, 4195, 4196, 4198,
  4199, 4200, 4201, 4202, 4203, 4204, 4205,
  4206, 4207, 4208, 4209, 4210, 4211, 4212,
  4213, 4214, 4215, 4216, 4217, 4218, 4219,
  4220, 4221, 4222, 4223, 4224, 4225, 4226,
  4227, 4228, 4229, 4230, 4231, 4232, 4233,
  4234, 4235, 4236, 4238, 4241, 4242, 4243,
  4244, 4245, 4246, 4248, 4249, 4250, 4251,
  4252, 4253, 4254,
  // Misc
  5998,
  // Admin / staff icons
  6000, 6001, 6002, 6003, 6004, 6005,
  6008, 6009, 6010, 6011, 6012, 6013,
  6014, 6015, 6016, 6017, 6018, 6023,
  6025, 6026, 6027, 6028, 6029, 6030,
  6031, 6032, 6033, 6034, 6035,
  // Special
  30000, 31337,
];

export default function IconSettingsTab() {
  const { userIconId, setUserIconId } = usePreferencesStore();
  const [hoveredIconId, setHoveredIconId] = useState<number | null>(null);
  
  // Local state for the input field to avoid live-updating the store
  const [pendingId, setPendingId] = useState(userIconId.toString());
  const selectedIconRef = useRef<HTMLDivElement>(null);

  // Sync local input if the user selects an icon from the grid
  useEffect(() => {
    setPendingId(userIconId.toString());
  }, [userIconId]);

  useEffect(() => {
    if (selectedIconRef.current) {
      selectedIconRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleApplyCustomId = () => {
    const numericId = parseInt(pendingId, 10);
    if (!isNaN(numericId)) {
      setUserIconId(numericId);
    }
  };

  // Allow pressing "Enter" to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleApplyCustomId();
    }
  };

  const isChanged = pendingId !== userIconId.toString();

  return (
    <div className="p-6 space-y-6">
      {/* Custom Icon ID Section */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
        <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">Manual Icon Entry</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">Icon ID</label>
            <input
              type="number"
              value={pendingId}
              onChange={(e) => setPendingId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 2055"
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          
          <button
            onClick={handleApplyCustomId}
            disabled={!isChanged || pendingId === ''}
            className={`px-4 py-2 rounded-md font-medium transition-all ${
              isChanged 
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md' 
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            Apply
          </button>
        </div>
        
        {/* Preview of what IS currently saved */}
        <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
          <span>Current selection:</span>
          <div className="p-1 bg-gray-100 dark:bg-gray-700 rounded">
            <UserIcon iconId={userIconId} size={20} />
          </div>
          <span className="font-mono">#{userIconId}</span>
        </div>
      </div>

      <hr className="border-gray-200 dark:border-gray-700" />

      {/* Grid Selection Section */}
      <div>
        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Quick Select:
          </p>
        </div>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 p-4 max-h-[350px] overflow-y-auto">
          <div className="grid grid-cols-7 gap-2">
            {CLASSIC_ICON_SET.map((iconId) => {
              const isSelected = iconId === userIconId;
              const isHovered = iconId === hoveredIconId;
              
              return (
                <div
                  key={iconId}
                  ref={isSelected ? selectedIconRef : null}
                  onClick={() => setUserIconId(iconId)}
                  onMouseEnter={() => setHoveredIconId(iconId)}
                  onMouseLeave={() => setHoveredIconId(null)}
                  className={`
                    p-2 rounded cursor-pointer transition-colors
                    ${isSelected 
                      ? 'bg-blue-500 ring-2 ring-blue-600' 
                      : isHovered 
                        ? 'bg-blue-100 dark:bg-blue-900/30' 
                        : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }
                  `}
                >
                  <div className="flex items-center justify-center">
                    <UserIcon iconId={iconId} size={32} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
