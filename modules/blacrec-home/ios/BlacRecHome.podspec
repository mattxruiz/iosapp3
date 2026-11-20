Pod::Spec.new do |s|
  s.name           = 'BlacRecHome'
  s.version        = '1.0.0'
  s.summary        = 'Soft-suspend BlacRec to the iPhone home screen'
  s.description    = 'Local Expo module'
  s.author         = 'Matt Ruiz'
  s.homepage       = 'https://example.com'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
