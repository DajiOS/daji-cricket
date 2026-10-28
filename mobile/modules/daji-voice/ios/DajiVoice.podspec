Pod::Spec.new do |s|
  s.name           = 'DajiVoice'
  s.version        = '1.0.0'
  s.summary        = 'Add to Siri for the Daji apps'
  s.description    = 'Shows Apple\'s Add to Siri screen for one voice action and opens the app at that action when Siri runs it.'
  s.author         = 'Daji Cricket Ground'
  s.homepage       = 'https://dajicricket.com'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Intents', 'IntentsUI'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '**/*.{h,m,swift}'
end
